import { describe, expect, it, vi } from 'vitest';
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
    outputs: {
      forEach(callback: (output: FakeOutput) => void) { outputs.forEach(callback); },
    },
  };
  return access;
}

function fakeNavigator(access: ReturnType<typeof fakeAccess>) {
  return { requestMIDIAccess: async () => access };
}

describe('WebMidiOutputManager failure boundaries', () => {
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
    expect(manager.snapshot()).toMatchObject({ status: 'error', selectedOutputId: null });
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
});
