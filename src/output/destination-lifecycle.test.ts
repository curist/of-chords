import { describe, expect, it } from 'vitest';
import type { InstrumentAction } from '../state/instrument';
import { WebMidiAccess } from '../midi/midi-access';
import { WebMidiOutputManager } from '../midi/midi-output';
import { OutputController } from './output-controller';
import type { OutputMode } from './output-controller';
import { bindDestinationLifecycle } from './destination-lifecycle';

function fakeLifecycle() {
  const outputCallbacks = { will: new Set<() => void>(), did: new Set<() => void>() };
  const midiCallbacks = { will: new Set<() => void>(), did: new Set<() => void>() };
  const register = (listeners: Set<() => void>, listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const output = {
    mode: 'builtin' as OutputMode,
    onWillChange: (listener: () => void) => register(outputCallbacks.will, listener),
    onDidChange: (listener: () => void) => register(outputCallbacks.did, listener),
  };
  const midi = {
    onDestinationWillChange: (listener: () => void) => register(midiCallbacks.will, listener),
    onDestinationDidChange: (listener: () => void) => register(midiCallbacks.did, listener),
  };
  const actions: InstrumentAction[] = [];
  const cleanup = bindDestinationLifecycle(output, midi, (action) => actions.push(action));
  const fire = (listeners: Set<() => void>) => { for (const listener of listeners) listener(); };
  return { output, outputCallbacks, midiCallbacks, actions, cleanup, fire };
}

describe('bindDestinationLifecycle', () => {
  it('panics before either output-mode transition, and resends only after entering MIDI mode', () => {
    const { output, outputCallbacks, actions, fire } = fakeLifecycle();
    fire(outputCallbacks.will);
    output.mode = 'midi';
    fire(outputCallbacks.did);
    fire(outputCallbacks.will);
    output.mode = 'builtin';
    fire(outputCallbacks.did);
    expect(actions.map((action) => action.type)).toEqual(['panic', 'resend-program', 'panic']);
  });

  it('ignores both MIDI destination events while built-in mode is active', () => {
    const { midiCallbacks, actions, fire } = fakeLifecycle();
    fire(midiCallbacks.will);
    fire(midiCallbacks.did);
    expect(actions).toEqual([]);
  });

  it('dispatches matching MIDI destination actions while MIDI mode is active', () => {
    const { output, midiCallbacks, actions, fire } = fakeLifecycle();
    output.mode = 'midi';
    fire(midiCallbacks.will);
    fire(midiCallbacks.did);
    expect(actions.map((action) => action.type)).toEqual(['panic', 'resend-program']);
  });

  it('checks current mode when a queued MIDI callback finally executes', () => {
    const { output, midiCallbacks, actions } = fakeLifecycle();
    output.mode = 'midi';
    const queued = [...midiCallbacks.did][0];
    output.mode = 'builtin';
    queued();
    expect(actions).toEqual([]);
  });

  it('unregisters all four callbacks and cleanup can be called twice', () => {
    const { output, outputCallbacks, midiCallbacks, actions, cleanup, fire } = fakeLifecycle();
    output.mode = 'midi';
    cleanup();
    cleanup();
    fire(outputCallbacks.will);
    fire(outputCallbacks.did);
    fire(midiCallbacks.will);
    fire(midiCallbacks.did);
    expect(actions).toEqual([]);
    expect([...outputCallbacks.will, ...outputCallbacks.did, ...midiCallbacks.will, ...midiCallbacks.did]).toEqual([]);
  });
});

interface FakePort {
  readonly id: string;
  readonly name: string;
  readonly state: 'connected';
  send(data: number[]): void;
}

async function realLifecycle(mode: OutputMode) {
  let sendFails = false;
  const first: FakePort = {
    id: 'one', name: 'One', state: 'connected',
    send() { if (sendFails) throw new Error('unavailable'); },
  };
  const second: FakePort = { id: 'two', name: 'Two', state: 'connected', send() {} };
  const ports: FakePort[] = [first, second];
  const browserAccess = {
    onstatechange: null as (() => void) | null,
    inputs: { forEach() {} },
    outputs: { forEach(callback: (port: FakePort) => void) { ports.forEach(callback); } },
  };
  const access = new WebMidiAccess({ requestMIDIAccess: async () => browserAccess });
  const storage = new Map<string, string>();
  const midi = new WebMidiOutputManager(access, {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
    removeItem: (key) => { storage.delete(key); },
  });
  const output = new OutputController({
    noteOn() {}, noteOff() {}, allNotesOff() {}, async resume() {},
  }, midi, { mode });
  await midi.initialize();
  midi.selectOutput('one');
  await Promise.resolve();
  const actions: InstrumentAction[] = [];
  const cleanup = bindDestinationLifecycle(output, midi, (action) => actions.push(action));
  return {
    output, midi, first, second, ports, browserAccess, actions,
    setSendFails(value: boolean) { sendFails = value; },
    cleanup,
  };
}

describe('bindDestinationLifecycle with real output managers', () => {
  for (const mode of ['builtin', 'midi'] as const) {
    it(`handles selected-port replacement in ${mode} mode`, async () => {
      const { midi, actions, cleanup } = await realLifecycle(mode);
      midi.selectOutput('two');
      await Promise.resolve();
      expect(actions.map((action) => action.type)).toEqual(mode === 'midi' ? ['panic', 'resend-program'] : []);
      cleanup();
      midi.dispose();
    });

    it(`handles physical disconnect and reconnect in ${mode} mode`, async () => {
      const { first, second, ports, browserAccess, midi, actions, cleanup } = await realLifecycle(mode);
      ports.splice(0, 2, second);
      browserAccess.onstatechange?.();
      expect(actions.map((action) => action.type)).toEqual(mode === 'midi' ? ['panic'] : []);
      ports.push(first);
      browserAccess.onstatechange?.();
      await Promise.resolve();
      expect(actions.map((action) => action.type)).toEqual(mode === 'midi' ? ['panic', 'resend-program'] : []);
      cleanup();
      midi.dispose();
    });

    it(`handles MIDI send failure in ${mode} mode`, async () => {
      const { midi, actions, setSendFails, cleanup } = await realLifecycle(mode);
      setSendFails(true);
      midi.noteOn(60);
      await Promise.resolve();
      expect(actions.map((action) => action.type)).toEqual(mode === 'midi' ? ['panic'] : []);
      cleanup();
      midi.dispose();
    });
  }

  it('does not resend a queued MIDI destination change after switching to built-in', async () => {
    const { output, midi, actions, cleanup } = await realLifecycle('midi');
    midi.selectOutput('two');
    output.setMode('builtin');
    expect(actions.map((action) => action.type)).toEqual(['panic', 'panic']);
    await Promise.resolve();
    expect(actions.map((action) => action.type)).toEqual(['panic', 'panic']);
    cleanup();
    midi.dispose();
  });
});
