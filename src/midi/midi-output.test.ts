import { describe, expect, it, vi } from 'vitest';
import { WebMidiAccess } from './midi-access';
import { getOptionalStorage, WebMidiOutputManager } from './midi-output';

interface FakeOutput {
  readonly id: string;
  readonly name: string;
  readonly manufacturer?: string | null;
  readonly state: 'connected' | 'disconnected';
  send(data: number[]): void;
}

function fakeAccess(outputs: FakeOutput[]) {
  const access = {
    onstatechange: null as (() => void) | null,
    inputs: { forEach() {} },
    outputs: {
      forEach(callback: (output: FakeOutput) => void) { outputs.forEach(callback); },
    },
  };
  return access;
}

function fakeNavigator(access: ReturnType<typeof fakeAccess>) {
  return new WebMidiAccess({ requestMIDIAccess: async () => access });
}

describe('WebMidiOutputManager failure boundaries', () => {
  it('restores MIDI automatically when permission was already granted', async () => {
    const access = fakeAccess([]);
    let requests = 0;
    const manager = new WebMidiOutputManager(new WebMidiAccess({
      permissions: { query: async () => ({ state: 'granted' as const }) },
      requestMIDIAccess: async () => { requests += 1; return access; },
    }), null);

    await (manager as unknown as { restoreIfPermitted?: () => Promise<void> }).restoreIfPermitted?.();

    expect(requests).toBe(1);
    expect(manager.snapshot().status).toBe('ready');
  });

  it('waits for a tap when MIDI permission still needs a prompt', async () => {
    let requests = 0;
    const manager = new WebMidiOutputManager(new WebMidiAccess({
      permissions: { query: async () => ({ state: 'prompt' as const }) },
      requestMIDIAccess: async () => { requests += 1; return fakeAccess([]); },
    }), null);

    await (manager as unknown as { restoreIfPermitted?: () => Promise<void> }).restoreIfPermitted?.();

    expect(requests).toBe(0);
    expect(manager.snapshot()).toMatchObject({
      status: 'idle',
      message: 'Tap MIDI to connect.',
    });
  });

  it('does not overwrite a connection made while permission status is loading', async () => {
    let finishQuery!: (status: { state: 'prompt' }) => void;
    const query = new Promise<{ state: 'prompt' }>((resolve) => { finishQuery = resolve; });
    const manager = new WebMidiOutputManager(new WebMidiAccess({
      permissions: { query: async () => query },
      requestMIDIAccess: async () => fakeAccess([]),
    }), null);

    const restoring = (manager as unknown as { restoreIfPermitted: () => Promise<void> }).restoreIfPermitted();
    await manager.initialize();
    finishQuery({ state: 'prompt' });
    await restoring;

    expect(manager.snapshot().status).toBe('ready');
  });

  it('reports modern permission rejection as denied', async () => {
    const manager = new WebMidiOutputManager(new WebMidiAccess({
      requestMIDIAccess: async () => { throw new DOMException('not allowed', 'NotAllowedError'); },
    }), null);

    await manager.initialize();

    expect(manager.snapshot()).toMatchObject({
      status: 'denied',
      message: 'MIDI access was denied.',
    });
  });

  it('does not request MIDI access again once ready', async () => {
    const access = fakeAccess([]);
    let requests = 0;
    const manager = new WebMidiOutputManager(new WebMidiAccess({
      requestMIDIAccess: async () => { requests += 1; return access; },
    }), null);

    await manager.initialize();
    await manager.initialize();

    expect(requests).toBe(1);
  });

  it('treats unavailable preference storage as optional', () => {
    expect(getOptionalStorage(() => { throw new DOMException('blocked', 'SecurityError'); })).toBeNull();
  });

  it('ignores throwing preference reads and writes', async () => {
    const output = { id: 'one', name: 'Synth', state: 'connected' as const, send() {} };
    const storage = {
      getItem() { throw new DOMException('blocked', 'SecurityError'); },
      setItem() { throw new DOMException('blocked', 'SecurityError'); },
      removeItem() { throw new DOMException('blocked', 'SecurityError'); },
    };
    const manager = new WebMidiOutputManager(fakeNavigator(fakeAccess([output])), storage);
    await expect(manager.initialize()).resolves.toBeUndefined();
    expect(() => manager.selectOutput('one')).not.toThrow();
    expect(manager.snapshot()).toMatchObject({ status: 'ready', selectedOutputId: 'one' });
  });

  it('does not retain or report a disconnected output', async () => {
    const output = { id: 'one', name: 'Synth', state: 'disconnected' as const, send() {} };
    const manager = new WebMidiOutputManager(fakeNavigator(fakeAccess([output])), null);
    await manager.initialize();
    manager.selectOutput('one');
    expect(manager.snapshot()).toMatchObject({ selectedOutputId: null, message: 'No MIDI output selected.' });
  });

  it('retains the preferred output identity while its port is disconnected', async () => {
    const outputs: FakeOutput[] = [{ id: 'one', name: 'Synth', manufacturer: 'Acme', state: 'connected', send() {} }];
    const stored = new Map<string, string>();
    const storage = {
      getItem(key: string) { return stored.get(key) ?? null; },
      setItem(key: string, value: string) { stored.set(key, value); },
      removeItem(key: string) { stored.delete(key); },
    };
    const browserAccess = fakeAccess(outputs);
    const manager = new WebMidiOutputManager(fakeNavigator(browserAccess), storage);
    await manager.initialize();
    manager.selectOutput('one');
    outputs.splice(0, 1);
    browserAccess.onstatechange?.();

    expect(manager.snapshot()).toMatchObject({
      selectedOutputId: null, preferredOutputId: 'one', preferredOutputLabel: 'Synth · Acme',
    });

    const restored = new WebMidiOutputManager(fakeNavigator(fakeAccess([])), storage);
    await restored.initialize();
    expect(restored.snapshot()).toMatchObject({
      selectedOutputId: null, preferredOutputId: 'one', preferredOutputLabel: 'Synth · Acme',
    });
  });

  it('contains send failures and requests lifecycle cleanup', async () => {
    const output = { id: 'one', name: 'Synth', state: 'connected' as const, send() { throw new DOMException('gone', 'InvalidStateError'); } };
    const manager = new WebMidiOutputManager(fakeNavigator(fakeAccess([output])), null);
    const cleanup = vi.fn();
    manager.onDestinationWillChange(cleanup);
    await manager.initialize();
    manager.selectOutput('one');
    expect(() => manager.noteOn(48)).not.toThrow();
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(manager.snapshot()).toMatchObject({
      status: 'ready',
      selectedOutputId: null,
      message: 'MIDI output became unavailable. Select an output to reconnect.',
    });
  });

  it('requests cleanup before switching outputs', async () => {
    const first = { id: 'one', name: 'One', state: 'connected' as const, send() {} };
    const second = { id: 'two', name: 'Two', state: 'connected' as const, send() {} };
    const manager = new WebMidiOutputManager(fakeNavigator(fakeAccess([first, second])), null);
    const cleanup = vi.fn();
    manager.onDestinationWillChange(cleanup);
    await manager.initialize();
    manager.selectOutput('one');
    manager.selectOutput('two');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(manager.snapshot().selectedOutputId).toBe('two');
  });

  it('sends MIDI 1.0 program change on channel one', async () => {
    const messages: number[][] = [];
    const output = { id: 'one', name: 'Synth', state: 'connected' as const, send(data: number[]) { messages.push(data); } };
    const manager = new WebMidiOutputManager(fakeNavigator(fakeAccess([output])), null);
    await manager.initialize();
    manager.selectOutput('one');
    manager.programChange(40);
    expect(messages).toEqual([[0xc0, 40]]);
  });

  it('keeps output selection recoverable when automatic patch resend fails', async () => {
    let shouldThrow = true;
    const messages: number[][] = [];
    const output = {
      id: 'one', name: 'Synth', state: 'connected' as const,
      send(data: number[]) {
        if (shouldThrow) throw new DOMException('gone', 'InvalidStateError');
        messages.push(data);
      },
    };
    const stored = new Map<string, string>();
    const storage = {
      getItem(key: string) { return stored.get(key) ?? null; },
      setItem(key: string, value: string) { stored.set(key, value); },
      removeItem(key: string) { stored.delete(key); },
    };
    const access = fakeAccess([output]);
    const manager = new WebMidiOutputManager(fakeNavigator(access), storage);
    manager.onDestinationDidChange(() => manager.programChange(0));
    await manager.initialize();
    manager.selectOutput('one');
    await Promise.resolve();

    expect(manager.snapshot()).toMatchObject({ status: 'ready', selectedOutputId: null });
    expect(manager.snapshot().message).toContain('unavailable');
    expect(Object.fromEntries(stored)).toEqual({
      'webchords.midi-output-id': 'one',
      'webchords.midi-output-label': 'Synth',
    });

    shouldThrow = false;
    access.onstatechange?.();
    await Promise.resolve();
    expect(manager.snapshot()).toMatchObject({ status: 'ready', selectedOutputId: 'one' });
    expect(messages).toEqual([[0xc0, 0]]);
  });

  it('keeps sending and refreshing output after an unrelated access listener unsubscribes', async () => {
    const messages: number[][] = [];
    const first = { id: 'one', name: 'First', state: 'connected' as const, send(data: number[]) { messages.push(data); } };
    const second = { id: 'two', name: 'Second', state: 'connected' as const, send(data: number[]) { messages.push(data); } };
    const outputs: FakeOutput[] = [first];
    const browserAccess = fakeAccess(outputs);
    const access = fakeNavigator(browserAccess);
    const manager = new WebMidiOutputManager(access, null);
    const unsubscribe = access.subscribe(() => {});
    await access.initialize();
    manager.selectOutput('one');

    unsubscribe();
    manager.noteOn(60);
    outputs[0] = second;
    browserAccess.onstatechange?.();
    expect(manager.snapshot().outputs.map((port) => port.id)).toEqual(['two']);
    manager.selectOutput('two');
    manager.noteOn(62);
    expect(messages).toEqual([[0x90, 60, 100], [0x90, 62, 100]]);
  });

  it('removes each destination listener independently on selected-port replacement', async () => {
    const first = { id: 'one', name: 'One', state: 'connected' as const, send() {} };
    const second = { id: 'two', name: 'Two', state: 'connected' as const, send() {} };
    const manager = new WebMidiOutputManager(fakeNavigator(fakeAccess([first, second])), null);
    await manager.initialize();
    manager.selectOutput('one');
    await Promise.resolve();
    const removedWill = vi.fn();
    const keptWill = vi.fn();
    const removedDid = vi.fn();
    const keptDid = vi.fn();
    const unsubscribeWill = manager.onDestinationWillChange(removedWill);
    manager.onDestinationWillChange(keptWill);
    const unsubscribeDid = manager.onDestinationDidChange(removedDid);
    manager.onDestinationDidChange(keptDid);

    unsubscribeWill();
    unsubscribeWill();
    unsubscribeDid();
    unsubscribeDid();
    manager.selectOutput('two');
    await Promise.resolve();

    expect(removedWill).not.toHaveBeenCalled();
    expect(keptWill).toHaveBeenCalledOnce();
    expect(removedDid).not.toHaveBeenCalled();
    expect(keptDid).toHaveBeenCalledOnce();
  });

  it('emits destination callbacks for physical disconnect and reconnect', async () => {
    const port = { id: 'one', name: 'One', state: 'connected' as const, send() {} };
    const outputs: FakeOutput[] = [port];
    const browserAccess = fakeAccess(outputs);
    const storage = new Map<string, string>();
    const manager = new WebMidiOutputManager(fakeNavigator(browserAccess), {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: (key) => { storage.delete(key); },
    });
    const will = vi.fn();
    const did = vi.fn();
    manager.onDestinationWillChange(will);
    manager.onDestinationDidChange(did);
    await manager.initialize();
    manager.selectOutput('one');
    await Promise.resolve();
    did.mockClear();

    outputs.splice(0, 1);
    browserAccess.onstatechange?.();
    expect(will).toHaveBeenCalledOnce();
    expect(manager.snapshot().selectedOutputId).toBeNull();
    outputs.push(port);
    browserAccess.onstatechange?.();
    await Promise.resolve();
    expect(did).toHaveBeenCalledOnce();
    expect(manager.snapshot().selectedOutputId).toBe('one');
  });

  it('emits destination cleanup for send failure', async () => {
    const port = { id: 'one', name: 'One', state: 'connected' as const, send() { throw new Error('unavailable'); } };
    const manager = new WebMidiOutputManager(fakeNavigator(fakeAccess([port])), null);
    const will = vi.fn();
    manager.onDestinationWillChange(will);
    await manager.initialize();
    manager.selectOutput('one');
    await Promise.resolve();

    manager.noteOn(60);
    await Promise.resolve();

    expect(will).toHaveBeenCalledOnce();
  });

  it('dispose clears destination listeners and its access subscription', async () => {
    const first = { id: 'one', name: 'One', state: 'connected' as const, send() {} };
    const second = { id: 'two', name: 'Two', state: 'connected' as const, send() {} };
    const outputs: FakeOutput[] = [first, second];
    const browserAccess = fakeAccess(outputs);
    const manager = new WebMidiOutputManager(fakeNavigator(browserAccess), null);
    await manager.initialize();
    manager.selectOutput('one');
    await Promise.resolve();
    const will = vi.fn();
    const did = vi.fn();
    manager.onDestinationWillChange(will);
    manager.onDestinationDidChange(did);

    manager.dispose();
    manager.dispose();
    outputs.splice(0, 2, second);
    browserAccess.onstatechange?.();
    expect(manager.snapshot().selectedOutputId).toBe('one');
    manager.selectOutput('two');
    await Promise.resolve();

    expect(manager.snapshot().outputs.map((port) => port.id)).toEqual(['two']);
    expect(will).not.toHaveBeenCalled();
    expect(did).not.toHaveBeenCalled();
  });
});
