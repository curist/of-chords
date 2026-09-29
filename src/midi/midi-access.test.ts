import { describe, expect, it } from 'vitest';
import { WebMidiAccess, type MidiAccessLike, type MidiInputPortLike, type MidiOutputPortLike } from './midi-access';

function input(id: string, state: 'connected' | 'disconnected' = 'connected'): MidiInputPortLike {
  return { id, name: `Input ${id}`, manufacturer: 'Maker', state, onmidimessage: null };
}

function output(id: string, state: 'connected' | 'disconnected' = 'connected'): MidiOutputPortLike {
  return { id, name: `Output ${id}`, manufacturer: 'Maker', state, send() {} };
}

function ports<T>(items: T[]) {
  return { forEach(callback: (item: T) => void) { items.forEach(callback); } };
}

function fakeAccess(inputs: MidiInputPortLike[] = [], outputs: MidiOutputPortLike[] = []): MidiAccessLike {
  return { inputs: ports(inputs), outputs: ports(outputs), onstatechange: null };
}

describe('WebMidiAccess', () => {
  it('deduplicates concurrent requests and reuses successful access', async () => {
    const browserAccess = fakeAccess();
    let requests = 0;
    let grant!: (access: MidiAccessLike) => void;
    const pending = new Promise<MidiAccessLike>((resolve) => { grant = resolve; });
    const access = new WebMidiAccess({ requestMIDIAccess: () => { requests++; return pending; } });

    const first = access.initialize();
    const second = access.initialize();
    expect(requests).toBe(1);
    expect(access.snapshot().status).toBe('requesting');
    grant(browserAccess);
    await Promise.all([first, second]);
    await access.initialize();

    expect(requests).toBe(1);
    expect(access.snapshot().status).toBe('ready');
  });

  it('reports a denied request and allows a later explicit retry', async () => {
    let requests = 0;
    const access = new WebMidiAccess({ requestMIDIAccess: async () => {
      requests++;
      if (requests === 1) throw new DOMException('blocked', 'NotAllowedError');
      return fakeAccess();
    } });

    await access.initialize();
    expect(access.snapshot()).toMatchObject({ status: 'denied', message: 'MIDI access was denied.' });
    await access.initialize();
    expect(requests).toBe(2);
    expect(access.snapshot().status).toBe('ready');
  });

  it('reports non-permission request failures as errors', async () => {
    const access = new WebMidiAccess({ requestMIDIAccess: async () => { throw new Error('device failure'); } });
    await access.initialize();
    expect(access.snapshot()).toMatchObject({ status: 'error', message: 'Could not access MIDI devices.' });
  });

  it('contains a synchronous browser request failure and permits retry', async () => {
    let requests = 0;
    const access = new WebMidiAccess({ requestMIDIAccess: () => {
      requests++;
      if (requests === 1) throw new DOMException('blocked', 'SecurityError');
      return Promise.resolve(fakeAccess());
    } });
    await expect(access.initialize()).resolves.toBeUndefined();
    expect(access.snapshot().status).toBe('denied');
    await access.initialize();
    expect(requests).toBe(2);
    expect(access.snapshot().status).toBe('ready');
  });

  it('restores access only after a granted permission query', async () => {
    let requests = 0;
    let permission: 'granted' | 'prompt' | 'denied' = 'prompt';
    const access = new WebMidiAccess({
      permissions: { query: async () => ({ state: permission }) },
      requestMIDIAccess: async () => { requests++; return fakeAccess(); },
    });

    await access.restoreIfPermitted();
    expect(requests).toBe(0);
    expect(access.snapshot()).toMatchObject({ status: 'idle', message: 'Tap MIDI to connect.' });
    permission = 'granted';
    await access.restoreIfPermitted();
    expect(requests).toBe(1);
    expect(access.snapshot().status).toBe('ready');
  });

  it('keeps a connection made while the permission query is pending', async () => {
    let finishQuery!: (value: { state: 'prompt' }) => void;
    const query = new Promise<{ state: 'prompt' }>((resolve) => { finishQuery = resolve; });
    const access = new WebMidiAccess({
      permissions: { query: async () => query },
      requestMIDIAccess: async () => fakeAccess(),
    });
    const restoring = access.restoreIfPermitted();
    await access.initialize();
    finishQuery({ state: 'prompt' });
    await restoring;
    expect(access.snapshot().status).toBe('ready');
  });

  it('publishes immutable connected port snapshots through one state-change handler', async () => {
    const inputs = [input('a'), input('off', 'disconnected')];
    const outputs = [output('b'), output('off', 'disconnected')];
    const browserAccess = fakeAccess(inputs, outputs);
    const access = new WebMidiAccess({ requestMIDIAccess: async () => browserAccess });
    const seen: ReturnType<typeof access.snapshot>[] = [];
    access.subscribe((snapshot) => seen.push(snapshot));
    await access.initialize();

    const first = access.snapshot();
    expect(first.inputs.map((port) => port.id)).toEqual(['a']);
    expect(first.outputs.map((port) => port.id)).toEqual(['b']);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.inputs)).toBe(true);
    expect(Object.isFrozen(first.inputs[0])).toBe(true);
    expect(access.findInput('a')).toBe(inputs[0]);
    expect(access.findOutput('b')).toBe(outputs[0]);
    expect(access.findInput('off')).toBeNull();
    expect(access.findOutput('off')).toBeNull();

    inputs[0] = input('c');
    outputs[0] = output('d');
    browserAccess.onstatechange?.();
    expect(access.snapshot().inputs.map((port) => port.id)).toEqual(['c']);
    expect(access.snapshot().outputs.map((port) => port.id)).toEqual(['d']);
    expect(first.inputs.map((port) => port.id)).toEqual(['a']);
    expect(seen.at(-1)).toBe(access.snapshot());
  });

  it('leaves discovery and other subscribers working when one unsubscribes', async () => {
    const outputs = [output('one')];
    const browserAccess = fakeAccess([], outputs);
    const access = new WebMidiAccess({ requestMIDIAccess: async () => browserAccess });
    const seenByFirst: string[][] = [];
    const seenBySecond: string[][] = [];
    const unsubscribe = access.subscribe((snapshot) => seenByFirst.push(snapshot.outputs.map((port) => port.id)));
    access.subscribe((snapshot) => seenBySecond.push(snapshot.outputs.map((port) => port.id)));
    await access.initialize();

    unsubscribe();
    outputs[0] = output('two');
    browserAccess.onstatechange?.();
    expect(seenByFirst.at(-1)).toEqual(['one']);
    expect(seenBySecond.at(-1)).toEqual(['two']);
    expect(access.findOutput('two')).toBe(outputs[0]);
  });
});
