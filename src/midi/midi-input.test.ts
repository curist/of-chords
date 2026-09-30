import { describe, expect, it, vi } from 'vitest';
import { WebMidiAccess, type MidiInputPortLike, type MidiAccessLike } from './midi-access';
import { InstrumentStore } from '../state/store';
import type { InstrumentAction } from '../state/instrument';
import { parseMidiNoteMessage, WebMidiInputManager } from './midi-input';

function input(id: string): MidiInputPortLike {
  return { id, name: `Input ${id}`, manufacturer: 'Maker', state: 'connected', onmidimessage: null };
}

function setup(
  inputs: MidiInputPortLike[] = [input('keys')],
  initialPreference: string | null = null,
  clock = () => 0,
  storageFailures: { set?: string; remove?: string } = {},
) {
  const values = new Map<string, string>();
  const storageAttempts: string[] = [];
  if (initialPreference) values.set('webchords.midi-input-id', initialPreference);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageAttempts.push(`set:${key}`);
      if (key === storageFailures.set) throw new Error('write blocked');
      values.set(key, value);
    },
    removeItem: (key: string) => {
      storageAttempts.push(`remove:${key}`);
      if (key === storageFailures.remove) throw new Error('removal blocked');
      values.delete(key);
    },
  };
  const browserAccess: MidiAccessLike = {
    inputs: { forEach(callback) { inputs.forEach(callback); } },
    outputs: { forEach() {} },
    onstatechange: null,
  };
  const access = new WebMidiAccess({ requestMIDIAccess: async () => browserAccess });
  const effects: string[] = [];
  const store = new InstrumentStore({
    acquire: (owner) => effects.push(`acquire:${owner}`),
    release: (owner) => effects.push(`release:${owner}`),
    panic: () => effects.push('panic'),
    programChange() {},
  });
  const actions: InstrumentAction[] = [];
  let harmonyReads = 0;
  const manager = new WebMidiInputManager(access, () => { harmonyReads++; return store.getState(); }, (action) => {
    actions.push(action);
    store.dispatch(action);
  }, { storage, now: clock });
  return { inputs, browserAccess, access, manager, values, storageAttempts, store, effects, actions, harmonyReads: () => harmonyReads };
}

function send(port: MidiInputPortLike, data: number[]): void {
  port.onmidimessage?.({ data: Uint8Array.from(data) });
}

describe('parseMidiNoteMessage', () => {
  it.each([
    { data: [0x90, 60, 127], want: { kind: 'on', channel: 0, note: 60, velocity: 127 } },
    { data: [0x9f, 12, 1], want: { kind: 'on', channel: 15, note: 12, velocity: 1 } },
    { data: [0x80, 60, 64], want: { kind: 'off', channel: 0, note: 60, velocity: 64 } },
    { data: [0x8f, 127, 0], want: { kind: 'off', channel: 15, note: 127, velocity: 0 } },
    { data: [0x92, 73, 0], want: { kind: 'off', channel: 2, note: 73, velocity: 0 } },
  ])('parses $data into a note event', ({ data, want }) => {
    expect(parseMidiNoteMessage(data)).toEqual(want);
  });

  it.each([
    [], [0x90], [0x90, 60], [0x90, 60, 100, 0],
    [0x90, -1, 100], [0x90, 128, 100], [0x90, 60, 128],
    [0x90, 60, 1.5], [0x190, 60, 100], [0xb0, 60, 100],
    [0xc0, 60], [0xf8], [0xf0, 1, 0xf7],
  ].map((data) => ({ data })))('ignores malformed or non-note data $data', ({ data }) => {
    expect(parseMidiNoteMessage(data)).toBeNull();
  });
});

describe('WebMidiInputManager', () => {
  it('maps scale notes to chord degrees and chromatic notes to exact pitches with velocity', async () => {
    const h = setup();
    await h.access.initialize();
    h.manager.selectInput('keys');
    send(h.inputs[0], [0x90, 60, 91]);
    send(h.inputs[0], [0x90, 66, 37]);
    expect(h.actions).toEqual([
      { type: 'press', owner: 'midi:keys:ch:0:note:60', degree: 1, velocity: 91, bassNote: 60 },
      { type: 'press-note', owner: 'midi:keys:ch:0:note:66', note: 66, velocity: 37 },
    ]);
    expect(h.store.getState().active['midi:keys:ch:0:note:60']).toMatchObject({ kind: 'chord', velocity: 91, notes: [60, 64, 67] });
    expect(h.store.getState().active['midi:keys:ch:0:note:66']).toMatchObject({ kind: 'literal', note: 66, velocity: 37 });
  });

  it('uses independent channel owners and releases the original gesture after harmony changes', async () => {
    const h = setup();
    await h.access.initialize();
    h.manager.selectInput('keys');
    send(h.inputs[0], [0x90, 60, 80]);
    send(h.inputs[0], [0x9f, 60, 70]);
    h.store.dispatch({ type: 'set-tonic', tonic: 2 });
    send(h.inputs[0], [0x80, 60, 0]);
    expect(h.harmonyReads()).toBe(2);
    expect(h.actions.at(-1)).toEqual({ type: 'release', owner: 'midi:keys:ch:0:note:60' });
    expect(h.store.getState().active['midi:keys:ch:0:note:60']).toBeUndefined();
    expect(h.store.getState().active['midi:keys:ch:15:note:60']).toMatchObject({ degree: 1 });
    send(h.inputs[0], [0x9f, 62, 44]);
    expect(h.actions.at(-1)).toEqual({ type: 'press', owner: 'midi:keys:ch:15:note:62', degree: 1, velocity: 44, bassNote: 62 });
    send(h.inputs[0], [0x8f, 60, 0]);
    expect(h.store.getState().active['midi:keys:ch:15:note:60']).toBeUndefined();
  });

  it('lets the reducer ignore duplicate presses and allows retrigger after global panic', async () => {
    const h = setup();
    await h.access.initialize();
    h.manager.selectInput('keys');
    send(h.inputs[0], [0x90, 60, 80]);
    send(h.inputs[0], [0x90, 60, 80]);
    expect(h.actions.filter((action) => action.type === 'press')).toHaveLength(2);
    expect(h.effects.filter((effect) => effect.startsWith('acquire:'))).toHaveLength(1);
    h.store.dispatch({ type: 'panic' });
    send(h.inputs[0], [0x90, 60, 80]);
    expect(h.effects.filter((effect) => effect.startsWith('acquire:'))).toHaveLength(2);
  });

  it('releases cleanup candidates before detaching old input and preserves unrelated owners', async () => {
    const first = input('one');
    const second = input('two');
    const h = setup([first, second]);
    await h.access.initialize();
    h.manager.selectInput('one');
    h.store.dispatch({ type: 'press', owner: 'keyboard:x', degree: 1 });
    send(first, [0x90, 60, 80]);
    let attachedDuringRelease = false;
    h.store.subscribe(() => {
      if (h.actions.at(-1)?.type === 'release') attachedDuringRelease = first.onmidimessage !== null;
    });
    h.manager.selectInput('two');
    expect(attachedDuringRelease).toBe(true);
    expect(first.onmidimessage).toBeNull();
    expect(second.onmidimessage).not.toBeNull();
    expect(h.store.getState().active['keyboard:x']).toBeDefined();
    expect(h.store.getState().active['midi:one:ch:0:note:60']).toBeUndefined();
  });

  it('ignores a queued callback from a previously selected input', async () => {
    const first = input('one');
    const second = input('two');
    const h = setup([first, second]);
    await h.access.initialize();
    h.manager.selectInput('one');
    const staleCallback = first.onmidimessage;
    h.manager.selectInput('two');
    staleCallback?.({ data: Uint8Array.from([0x90, 60, 80]) });
    expect(h.actions).toEqual([]);
    expect(Object.keys(h.store.getState().active)).toEqual([]);
  });

  it('persists selection, retains preference through disconnect, and reattaches on reconnect', async () => {
    const first = input('one');
    const h = setup([first]);
    await h.access.initialize();
    h.manager.selectInput('one');
    expect(h.values.get('webchords.midi-input-id')).toBe('one');
    expect(h.values.get('webchords.midi-input-label')).toBe('Input one · Maker');
    send(first, [0x90, 60, 80]);
    h.inputs.splice(0, 1);
    h.browserAccess.onstatechange?.();
    expect(h.manager.snapshot()).toMatchObject({
      status: 'disconnected', preferredInputId: 'one', preferredInputLabel: 'Input one · Maker', attachedInputId: null,
    });
    expect(h.values.get('webchords.midi-input-id')).toBe('one');
    expect(h.values.get('webchords.midi-input-label')).toBe('Input one · Maker');
    expect(first.onmidimessage).toBeNull();
    expect(h.store.getState().active['midi:one:ch:0:note:60']).toBeUndefined();
    h.inputs.push(input('one'));
    h.browserAccess.onstatechange?.();
    expect(h.manager.snapshot()).toMatchObject({ status: 'ready', attachedInputId: 'one' });
    expect(h.inputs[0].onmidimessage).not.toBeNull();
    h.manager.selectInput(null);
    expect(h.manager.snapshot()).toMatchObject({ preferredInputId: null, attachedInputId: null });
    expect(h.values.has('webchords.midi-input-id')).toBe(false);
    expect(h.values.has('webchords.midi-input-label')).toBe(false);
  });

  it('still stores the input label and emits selection when the ID write fails', async () => {
    const h = setup([input('keys')], null, () => 0, { set: 'webchords.midi-input-id' });
    await h.access.initialize();
    const snapshots = vi.fn();
    h.manager.subscribe(snapshots);

    expect(() => h.manager.selectInput('keys')).not.toThrow();
    expect(h.storageAttempts).toEqual([
      'set:webchords.midi-input-id', 'set:webchords.midi-input-label',
    ]);
    expect(h.values.get('webchords.midi-input-label')).toBe('Input keys · Maker');
    expect(h.manager.snapshot()).toMatchObject({ preferredInputId: 'keys', attachedInputId: 'keys' });
    expect(snapshots).toHaveBeenLastCalledWith(expect.objectContaining({ attachedInputId: 'keys' }));
  });

  it('still removes the input label and emits deselection when ID removal fails', async () => {
    const h = setup([input('keys')], null, () => 0, { remove: 'webchords.midi-input-id' });
    await h.access.initialize();
    h.manager.selectInput('keys');
    const snapshots = vi.fn();
    h.manager.subscribe(snapshots);

    expect(() => h.manager.selectInput(null)).not.toThrow();
    expect(h.storageAttempts.slice(-2)).toEqual([
      'remove:webchords.midi-input-id', 'remove:webchords.midi-input-label',
    ]);
    expect(h.values.has('webchords.midi-input-label')).toBe(false);
    expect(h.manager.snapshot()).toMatchObject({ preferredInputId: null, attachedInputId: null });
    expect(snapshots).toHaveBeenLastCalledWith(expect.objectContaining({ attachedInputId: null }));
  });

  it('restores stored input and disposes without affecting shared access', async () => {
    const h = setup([input('keys')], 'keys');
    await h.access.initialize();
    expect(h.manager.snapshot().attachedInputId).toBe('keys');
    send(h.inputs[0], [0x90, 60, 80]);
    h.manager.dispose();
    expect(h.inputs[0].onmidimessage).toBeNull();
    expect(h.store.getState().active['midi:keys:ch:0:note:60']).toBeUndefined();
    expect(h.access.findInput('keys')).toBe(h.inputs[0]);
    const seen = vi.fn();
    h.access.subscribe(seen);
    h.browserAccess.onstatechange?.();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('permits 64 Note Ons within 100 ms, then suspends, releases and panics before the 65th dispatch', async () => {
    let time = 1000;
    const h = setup([input('keys')], null, () => time);
    await h.access.initialize();
    h.manager.selectInput('keys');
    for (let index = 0; index < 64; index++) send(h.inputs[0], [0x90, index, 90]);
    expect(h.actions.filter((action) => action.type === 'press' || action.type === 'press-note')).toHaveLength(64);
    send(h.inputs[0], [0x90, 64, 90]);
    expect(h.actions.filter((action) => action.type === 'press' || action.type === 'press-note')).toHaveLength(64);
    expect(h.manager.snapshot()).toMatchObject({
      status: 'suspended', preferredInputId: 'keys', attachedInputId: null,
      message: 'Possible MIDI feedback loop detected. Check MIDI routing, then resume input.',
    });
    expect(h.inputs[0].onmidimessage).toBeNull();
    expect(Object.keys(h.store.getState().active)).toHaveLength(0);
    expect(h.effects.at(-1)).toBe('panic');
    h.inputs.splice(0, 1);
    h.browserAccess.onstatechange?.();
    h.inputs.push(input('keys'));
    h.browserAccess.onstatechange?.();
    expect(h.manager.snapshot().status).toBe('suspended');
    expect(h.inputs[0].onmidimessage).toBeNull();
    h.manager.resume();
    expect(h.manager.snapshot()).toMatchObject({ status: 'ready', attachedInputId: 'keys' });
    time = 1010;
    send(h.inputs[0], [0x90, 60, 70]);
    expect(h.store.getState().active['midi:keys:ch:0:note:60']).toBeDefined();
  });

  it('requires explicit resume after clearing and reselecting a suspended input', async () => {
    const h = setup();
    await h.access.initialize();
    h.manager.selectInput('keys');
    for (let index = 0; index < 65; index++) send(h.inputs[0], [0x90, index, 90]);
    expect(h.manager.snapshot().status).toBe('suspended');

    h.manager.selectInput(null);
    expect(h.manager.snapshot()).toMatchObject({ status: 'suspended', preferredInputId: null, attachedInputId: null });
    expect(h.values.has('webchords.midi-input-id')).toBe(false);
    h.manager.selectInput('keys');
    expect(h.manager.snapshot()).toMatchObject({ status: 'suspended', preferredInputId: 'keys', attachedInputId: null });
    expect(h.inputs[0].onmidimessage).toBeNull();
    const actionCount = h.actions.length;
    send(h.inputs[0], [0x90, 72, 80]);
    expect(h.actions).toHaveLength(actionCount);
    expect(h.store.getState().active['midi:keys:ch:0:note:72']).toBeUndefined();

    h.manager.resume();
    expect(h.manager.snapshot()).toMatchObject({ status: 'ready', attachedInputId: 'keys' });
    send(h.inputs[0], [0x90, 72, 80]);
    expect(h.store.getState().active['midi:keys:ch:0:note:72']).toBeDefined();
  });

  it('does not count Note Offs or ignored messages toward the rolling limit', async () => {
    let time = 0;
    const h = setup([input('keys')], null, () => time);
    await h.access.initialize();
    h.manager.selectInput('keys');
    for (let index = 0; index < 64; index++) {
      send(h.inputs[0], [0x90, index, 70]);
      send(h.inputs[0], [0x80, index, 0]);
      send(h.inputs[0], [0xb0, 7, 100]);
    }
    time = 100;
    send(h.inputs[0], [0x90, 64, 70]);
    expect(h.manager.snapshot().status).toBe('ready');
    expect(h.store.getState().active['midi:keys:ch:0:note:64']).toBeDefined();
  });
});
