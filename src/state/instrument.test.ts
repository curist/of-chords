import { describe, expect, it } from 'vitest';
import { createInitialState, reduceInstrument, type InstrumentAction } from './instrument';
import { InstrumentStore, type InstrumentEffectTarget } from './store';

class RecordingTarget implements InstrumentEffectTarget {
  readonly events: string[] = [];
  acquire(owner: string, notes: readonly number[], velocity: number): void { this.events.push(`acquire:${owner}:${notes.join(',')}:${velocity}`); }
  release(owner: string): void { this.events.push(`release:${owner}`); }
  panic(): void { this.events.push('panic'); }
  programChange(program: number): void { this.events.push(`program:${program}`); }
}

describe('instrument reducer and store', () => {
  it('turns a chord press into state and an explicit acquire effect', () => {
    const result = reduceInstrument(createInitialState(), { type: 'press', owner: 'keyboard:KeyA', degree: 1 });
    expect(result.state.active['keyboard:KeyA']).toMatchObject({ kind: 'chord', name: 'C', roman: 'I', notes: [48, 52, 55] });
    expect(result.effects).toEqual([{ type: 'acquire', owner: 'keyboard:KeyA', notes: [48, 52, 55], velocity: 100 }]);
  });

  it('passes an explicit degree velocity to the acquire effect and store target', () => {
    const target = new RecordingTarget();
    const store = new InstrumentStore(target);
    store.dispatch({ type: 'press', owner: 'midi:1', degree: 1, velocity: 37 });
    expect(store.getState().active['midi:1']).toMatchObject({ kind: 'chord', notes: [48, 52, 55] });
    expect(target.events).toEqual(['acquire:midi:1:48,52,55:37']);
  });

  it('anchors a MIDI chord on the incoming note and ignores inversion for that gesture', () => {
    let state = reduceInstrument(createInitialState(), { type: 'set-inversion', inversion: 2 }).state;
    const result = reduceInstrument(state, {
      type: 'press', owner: 'midi:1', degree: 1, velocity: 37, bassNote: 72,
    });
    expect(result.state.active['midi:1']).toMatchObject({ kind: 'chord', notes: [72, 76, 79] });
    expect(result.effects).toEqual([{ type: 'acquire', owner: 'midi:1', notes: [72, 76, 79], velocity: 37 }]);
  });

  it('omits anchored chord tones that would exceed the MIDI note range', () => {
    const result = reduceInstrument(createInitialState(), {
      type: 'press', owner: 'midi:high', degree: 2, bassNote: 122,
    });
    expect(result.state.active['midi:high'].notes).toEqual([122, 125]);
  });

  it('records a literal note and omits it from chord history', () => {
    const result = reduceInstrument(createInitialState(), { type: 'press-note', owner: 'midi:61', note: 61, velocity: 73 });
    expect(result.state.active['midi:61']).toMatchObject({
      kind: 'literal', note: 61, name: 'C#4', noteNames: ['C#4'], notes: [61], velocity: 73,
    });
    expect(result.effects).toEqual([{ type: 'acquire', owner: 'midi:61', notes: [61], velocity: 73 }]);
    expect(result.state.history).toEqual([]);
  });

  it.each([
    [{ type: 'press', owner: 'held', degree: 1, velocity: 37 }, [48, 52, 55]],
    [{ type: 'press-note', owner: 'held', note: 61, velocity: 73 }, [61]],
  ] as const)('keeps the pressed notes through settings changes until matching release', (press, notes) => {
    let state = reduceInstrument(createInitialState(), press).state;
    state = reduceInstrument(state, { type: 'set-tonic', tonic: 2 }).state;
    state = reduceInstrument(state, { type: 'set-mode', mode: 'naturalMinor' }).state;
    state = reduceInstrument(state, { type: 'set-shape', shape: 'seventh' }).state;
    state = reduceInstrument(state, { type: 'set-inversion', inversion: 1 }).state;
    expect(state.active.held.notes).toEqual(notes);
    const released = reduceInstrument(state, { type: 'release', owner: 'held' });
    expect(released.effects).toEqual([{ type: 'release', owner: 'held' }]);
    expect(released.state.active.held).toBeUndefined();
  });

  it('ignores a duplicate literal press but accepts the same owner after panic', () => {
    const first = reduceInstrument(createInitialState(), { type: 'press-note', owner: 'held', note: 61, velocity: 73 });
    const duplicate = reduceInstrument(first.state, { type: 'press-note', owner: 'held', note: 62, velocity: 25 });
    expect(duplicate.state).toBe(first.state);
    expect(duplicate.effects).toEqual([]);
    const cleared = reduceInstrument(duplicate.state, { type: 'panic' });
    const pressedAgain = reduceInstrument(cleared.state, { type: 'press-note', owner: 'held', note: 61, velocity: 45 });
    expect(pressedAgain.effects).toEqual([{ type: 'acquire', owner: 'held', notes: [61], velocity: 45 }]);
  });

  it('clamps literal notes and supplied velocities to MIDI integer ranges', () => {
    const result = reduceInstrument(createInitialState(), { type: 'press-note', owner: 'held', note: 128.9, velocity: 0.9 });
    expect(result.state.active.held).toMatchObject({ note: 127, name: 'G9', notes: [127], velocity: 1 });
    expect(result.effects).toEqual([{ type: 'acquire', owner: 'held', notes: [127], velocity: 1 }]);
  });

  it('ignores repeat presses from an active owner', () => {
    const first = reduceInstrument(createInitialState(), { type: 'press', owner: 'keyboard:KeyA', degree: 1 });
    const repeat = reduceInstrument(first.state, { type: 'press', owner: 'keyboard:KeyA', degree: 1 });
    expect(repeat.state).toBe(first.state);
    expect(repeat.effects).toEqual([]);
  });

  it('snapshots modifiers for held chords and applies changes to the next press', () => {
    let state = reduceInstrument(createInitialState(), { type: 'press', owner: 'a', degree: 1 }).state;
    state = reduceInstrument(state, { type: 'set-shape', shape: 'seventh' }).state;
    state = reduceInstrument(state, { type: 'press', owner: 'g', degree: 5 }).state;
    expect(state.active.a.notes).toEqual([48, 52, 55]);
    expect(state.active.g).toMatchObject({ name: 'G7', notes: [55, 59, 62, 65] });
  });

  it('changes mode for subsequent chord presses', () => {
    let state = reduceInstrument(createInitialState(), { type: 'set-tonic', tonic: 9 }).state;
    state = reduceInstrument(state, { type: 'set-mode', mode: 'naturalMinor' }).state;
    state = reduceInstrument(state, { type: 'press', owner: 'a', degree: 1 }).state;
    expect(state.mode).toBe('naturalMinor');
    expect(state.active.a).toMatchObject({ name: 'Am', roman: 'i', notes: [57, 60, 64] });
  });

  it('stores a bounded recent progression', () => {
    let state = createInitialState();
    for (let index = 0; index < 10; index += 1) {
      state = reduceInstrument(state, { type: 'press', owner: `owner:${index}`, degree: ((index % 7) + 1) as 1 }).state;
    }
    expect(state.history).toHaveLength(8);
    expect(state.history[0].owner).toBe('owner:2');
  });

  it('runs effects after reducing and panic clears every active owner', () => {
    const target = new RecordingTarget();
    const store = new InstrumentStore(target);
    const actions: InstrumentAction[] = [
      { type: 'press', owner: 'a', degree: 1 },
      { type: 'press', owner: 's', degree: 2 },
      { type: 'release', owner: 'a' },
      { type: 'panic' },
    ];
    actions.forEach((action) => store.dispatch(action));
    expect(target.events).toEqual([
      'acquire:a:48,52,55:100', 'acquire:s:50,53,57:100', 'release:a', 'panic',
    ]);
    expect(store.getState().active).toEqual({});
  });

  it('does not impose a program before the player chooses one', () => {
    const result = reduceInstrument(createInitialState(), { type: 'resend-program' });
    expect(result.state.program).toBeNull();
    expect(result.effects).toEqual([]);
  });

  it('wraps program stepping in both directions and clears held chords', () => {
    let state = reduceInstrument(createInitialState(), { type: 'set-program', program: 0 }).state;
    state = reduceInstrument(state, { type: 'press', owner: 'a', degree: 1 }).state;
    const previous = reduceInstrument(state, { type: 'step-program', direction: -1 });
    expect(previous.state.program).toBe(127);
    expect(previous.state.active).toEqual({});
    expect(previous.effects).toEqual([{ type: 'panic' }, { type: 'program-change', program: 127 }]);
    const next = reduceInstrument(previous.state, { type: 'step-program', direction: 1 });
    expect(next.state.program).toBe(0);
  });

  it('selects a program directly and sends it after panic', () => {
    let state = createInitialState();
    state = reduceInstrument(state, { type: 'press', owner: 'a', degree: 1 }).state;
    const result = reduceInstrument(state, { type: 'set-program', program: 40 });
    expect(result.state.program).toBe(40);
    expect(result.state.active).toEqual({});
    expect(result.effects).toEqual([{ type: 'panic' }, { type: 'program-change', program: 40 }]);
  });

  it('resends the selected program after a MIDI destination change', () => {
    const state = reduceInstrument(createInitialState(), { type: 'set-program', program: 40 }).state;
    const result = reduceInstrument(state, { type: 'resend-program' });
    expect(result.effects).toEqual([{ type: 'program-change', program: 40 }]);
  });
});
