// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { App, commitModeSelection, commitProgramSelection, commitTonicSelection, commitVoiceSelection, GamepadNotification } from './app';
import type { InstrumentAction } from '../state/instrument';
import { InstrumentStore } from '../state/store';
import { WebAudioSynthSink } from '../audio/synth';
import { OutputController } from '../output/output-controller';
import type { WebMidiInputManager, MidiInputSnapshot } from '../midi/midi-input';
import type { WebMidiOutputManager, MidiOutputSnapshot } from '../midi/midi-output';
import type { WebMidiAccess } from '../midi/midi-access';

function createAppFixture() {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  // happy-dom provides option elements but not the browser's Option constructor.
  vi.stubGlobal('Option', function Option(label: string, value: string) {
    const option = document.createElement('option');
    option.textContent = label;
    option.value = value;
    return option;
  });
  const synth = new WebAudioSynthSink();
  const outputSnapshot = {
    status: 'idle', message: 'MIDI access has not been requested.', outputs: [],
    selectedOutputId: null, preferredOutputId: null, preferredOutputLabel: null,
  } satisfies MidiOutputSnapshot;
  const unsubscribeMidi = vi.fn();
  const midi = {
    initialize: vi.fn(async () => {}),
    selectOutput: vi.fn(),
    subscribe(listener: (snapshot: MidiOutputSnapshot) => void) { listener(outputSnapshot); return unsubscribeMidi; },
    noteOn() {}, noteOff() {}, allNotesOff() {}, programChange() {},
  };
  const output = new OutputController(synth, midi, { storage: null });
  const store = new InstrumentStore({ acquire() {}, release() {}, panic() {}, programChange() {} });
  const unsubscribeStore = vi.fn();
  const originalStoreSubscribe = store.subscribe.bind(store);
  vi.spyOn(store, 'subscribe').mockImplementation((listener) => {
    const unsubscribe = originalStoreSubscribe(listener);
    return () => { unsubscribeStore(); unsubscribe(); };
  });
  const unsubscribeOutput = vi.fn();
  const originalOutputSubscribe = output.subscribe.bind(output);
  vi.spyOn(output, 'subscribe').mockImplementation((listener) => {
    const unsubscribe = originalOutputSubscribe(listener);
    return () => { unsubscribeOutput(); unsubscribe(); };
  });
  const unsubscribeInput = vi.fn();
  const initialInput: MidiInputSnapshot = {
    status: 'idle', message: 'MIDI access has not been requested.', inputs: [],
    preferredInputId: null, preferredInputLabel: null, attachedInputId: null,
  };
  const input = {
    selectInput: vi.fn(), resume: vi.fn(),
    subscribe(listener: (snapshot: MidiInputSnapshot) => void) { listener(initialInput); return unsubscribeInput; },
  };
  const access = { initialize: vi.fn(async () => {}) };
  const app = new App(root, store, midi as unknown as WebMidiOutputManager, output, synth,
    input as unknown as WebMidiInputManager, access as unknown as WebMidiAccess);
  return {
    app, root, store, output, input, access, synth,
    unsubscribeStore, unsubscribeMidi, unsubscribeInput, unsubscribeOutput,
  };
}

describe('App disposal', () => {
  it('disposes constructed views and control listeners if a later store subscription throws', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    vi.stubGlobal('Option', function Option(label: string, value: string) {
      const option = document.createElement('option');
      option.textContent = label;
      option.value = value;
      return option;
    });
    const synth = new WebAudioSynthSink();
    const unsubscribeMidi = vi.fn();
    const midi = {
      selectOutput: vi.fn(), subscribe(listener: (snapshot: MidiOutputSnapshot) => void) {
        listener({ status: 'idle', message: 'MIDI access has not been requested.', outputs: [],
          selectedOutputId: null, preferredOutputId: null, preferredOutputLabel: null });
        return unsubscribeMidi;
      },
      noteOn() {}, noteOff() {}, allNotesOff() {}, programChange() {},
    };
    const output = new OutputController(synth, midi, { storage: null });
    const unsubscribeOutput = vi.fn();
    const originalOutputSubscribe = output.subscribe.bind(output);
    vi.spyOn(output, 'subscribe').mockImplementation((listener) => {
      const unsubscribe = originalOutputSubscribe(listener);
      return () => { unsubscribeOutput(); unsubscribe(); };
    });
    const store = new InstrumentStore({ acquire() {}, release() {}, panic() {}, programChange() {} });
    vi.spyOn(store, 'subscribe').mockImplementation(() => { throw new Error('store subscribe failed'); });
    const unsubscribeInput = vi.fn();
    const input = {
      selectInput: vi.fn(), resume: vi.fn(), subscribe(listener: (snapshot: MidiInputSnapshot) => void) {
        listener({ status: 'idle', message: 'MIDI access has not been requested.', inputs: [],
          preferredInputId: null, preferredInputLabel: null, attachedInputId: null });
        return unsubscribeInput;
      },
    };
    const access = { initialize: vi.fn(async () => {}) };

    expect(() => new App(root, store, midi as unknown as WebMidiOutputManager, output, synth,
      input as unknown as WebMidiInputManager, access as unknown as WebMidiAccess)).toThrow('store subscribe failed');
    root.querySelector<HTMLButtonElement>('[data-shape="seventh"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-output="midi"]')!.click();
    root.querySelector<HTMLButtonElement>('#midi-input-action')!.click();
    expect(store.getState().shape).toBe('triad');
    expect(output.mode).toBe('builtin');
    expect(access.initialize).not.toHaveBeenCalled();
    expect(unsubscribeMidi).toHaveBeenCalledOnce();
    expect(unsubscribeInput).toHaveBeenCalledOnce();
    expect(unsubscribeOutput).toHaveBeenCalledOnce();
  });

  it('unsubscribes all four sources exactly once', () => {
    const fixture = createAppFixture();

    fixture.app.dispose();
    fixture.app.dispose();

    expect(fixture.unsubscribeStore).toHaveBeenCalledOnce();
    expect(fixture.unsubscribeMidi).toHaveBeenCalledOnce();
    expect(fixture.unsubscribeInput).toHaveBeenCalledOnce();
    expect(fixture.unsubscribeOutput).toHaveBeenCalledOnce();
  });

  it('removes control listeners so root events no longer change the instrument', () => {
    const { app, root, store, input } = createAppFixture();
    const shape = root.querySelector<HTMLButtonElement>('[data-shape="seventh"]')!;
    shape.click();
    expect(store.getState().shape).toBe('seventh');

    app.dispose();
    root.querySelector<HTMLButtonElement>('[data-shape="triad"]')!.click();
    root.querySelector<HTMLSelectElement>('#midi-input')!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(store.getState().shape).toBe('seventh');
    expect(input.selectInput).not.toHaveBeenCalled();
  });

  it('cancels a pending gamepad notification timeout', () => {
    vi.useFakeTimers();
    try {
      const { app, root } = createAppFixture();
      app.setGamepadStatus('ready');
      expect(vi.getTimerCount()).toBe(1);

      app.dispose();
      app.dispose();

      expect(vi.getTimerCount()).toBe(0);
      expect(root.querySelector<HTMLElement>('#gamepad-notification')!.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('tonic selection', () => {
  it('dispatches the selected tonic', () => {
    const select = { value: '7' } as HTMLSelectElement;
    const actions: InstrumentAction[] = [];

    commitTonicSelection(select, (action) => actions.push(action));

    expect(actions).toEqual([{ type: 'set-tonic', tonic: 7 }]);
  });

  it.each(['', ' ', 'NaN', 'Infinity', '12'])('ignores invalid tonic %j', (value) => {
    const actions: InstrumentAction[] = [];
    commitTonicSelection({ value } as HTMLSelectElement, (action) => actions.push(action));
    expect(actions).toEqual([]);
  });
});

describe('mode selection', () => {
  it('dispatches the selected mode', () => {
    const select = { value: 'naturalMinor' } as HTMLSelectElement;
    const actions: InstrumentAction[] = [];

    commitModeSelection(select, (action) => actions.push(action));

    expect(actions).toEqual([{ type: 'set-mode', mode: 'naturalMinor' }]);
  });

  it.each(['', ' ', '__proto__', 'unknown'])('ignores invalid mode %j', (value) => {
    const actions: InstrumentAction[] = [];
    commitModeSelection({ value } as HTMLSelectElement, (action) => actions.push(action));
    expect(actions).toEqual([]);
  });
});

describe('select focus', () => {
  it('blurs every select after its selection changes', () => {
    const { root } = createAppFixture();
    const selects = [...root.querySelectorAll<HTMLSelectElement>('select')];

    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      select.disabled = false;
      select.focus();
      expect(document.activeElement).toBe(select);

      select.dispatchEvent(new Event('change', { bubbles: true }));

      expect(document.activeElement).not.toBe(select);
    }
  });
});

describe('program selection', () => {
  it('translates the displayed 1-based program and returns focus to the instrument', () => {
    const blur = vi.fn();
    const input = { value: '41', blur } as unknown as HTMLInputElement;
    const actions: InstrumentAction[] = [];

    commitProgramSelection(input, (action) => actions.push(action));

    expect(actions).toEqual([{ type: 'set-program', program: 40 }]);
    expect(blur).toHaveBeenCalledOnce();
  });

  it.each(['', ' ', 'NaN', 'Infinity', '1.5', '0', '129'])('blurs without dispatching invalid program %j', (value) => {
    const blur = vi.fn();
    const actions: InstrumentAction[] = [];
    commitProgramSelection({ value, blur } as unknown as HTMLInputElement, (action) => actions.push(action));
    expect(actions).toEqual([]);
    expect(blur).toHaveBeenCalledOnce();
  });
});

describe('DOM event boundaries', () => {
  it.each([
    ['#tonic-select', 'change', 'value', '12'],
    ['#mode-select', 'change', 'value', '__proto__'],
    ['[data-shape="triad"]', 'click', 'shape', '__proto__'],
    ['[data-inversion="0"]', 'click', 'inversion', '1.5'],
    ['#program-input', 'change', 'value', 'Infinity'],
  ] as const)('ignores invalid %s %s', (selector, type, property, value) => {
    const { root, store } = createAppFixture();
    const dispatch = vi.spyOn(store, 'dispatch');
    const element = root.querySelector<HTMLElement>(selector)!;
    if (property === 'value') (element as HTMLInputElement | HTMLSelectElement).value = value;
    else element.dataset[property] = value;

    element.dispatchEvent(new Event(type, { bubbles: true }));

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores an invalid chord degree without acquiring a pointer owner', () => {
    const { root, store } = createAppFixture();
    const dispatch = vi.spyOn(store, 'dispatch');
    const button = root.querySelector<HTMLButtonElement>('[data-degree="1"]')!;
    button.dataset.degree = '8';
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores invalid voice parameters without changing synth parameters', () => {
    const { root, synth } = createAppFixture();
    const setParams = vi.spyOn(synth, 'setParams');
    const input = root.querySelector<HTMLInputElement>('[data-voice-param="harmonicMix"]')!;
    input.max = '2';
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const select = root.querySelector<HTMLSelectElement>('[data-voice-param="oscillator"]')!;
    select.dataset.voiceParam = '__proto__';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    expect(setParams).not.toHaveBeenCalled();
    expect(synth.params.harmonicMix).toBe(0.18);
  });

  it('commits valid shape, inversion, chord, and output values through their events', () => {
    const { root, store, output, access } = createAppFixture();
    root.querySelector<HTMLButtonElement>('[data-shape="seventh"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-inversion="1"]')!.click();
    expect(store.getState().shape).toBe('seventh');
    expect(store.getState().inversion).toBe(1);

    const chord = root.querySelector<HTMLButtonElement>('[data-degree="1"]')!;
    chord.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
    expect(Object.values(store.getState().active).some((gesture) => gesture.kind === 'chord' && gesture.degree === 1)).toBe(true);

    root.querySelector<HTMLButtonElement>('[data-output="midi"]')!.click();
    expect(output.mode).toBe('midi');
    expect(access.initialize).toHaveBeenCalledOnce();
  });

  it('commits valid tonic, mode, program, and voice values through their events', () => {
    const { root, store, synth } = createAppFixture();
    const tonic = root.querySelector<HTMLSelectElement>('#tonic-select')!;
    tonic.value = '7';
    tonic.dispatchEvent(new Event('change', { bubbles: true }));
    const mode = root.querySelector<HTMLSelectElement>('#mode-select')!;
    mode.value = 'dorian';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.getState().tonic).toBe(7);
    expect(store.getState().mode).toBe('dorian');

    const program = root.querySelector<HTMLInputElement>('#program-input')!;
    program.value = '41';
    program.focus();
    program.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.getState().program).toBe(40);
    expect(document.activeElement).not.toBe(program);

    const mix = root.querySelector<HTMLInputElement>('[data-voice-param="harmonicMix"]')!;
    mix.value = '0.4';
    mix.dispatchEvent(new Event('input', { bubbles: true }));
    const oscillator = root.querySelector<HTMLSelectElement>('[data-voice-param="oscillator"]')!;
    oscillator.value = 'square';
    oscillator.dispatchEvent(new Event('input', { bubbles: true }));
    expect(synth.params.harmonicMix).toBe(0.4);
    expect(synth.params.oscillator).toBe('square');
  });
});

describe('MIDI input controls', () => {
  it('places MIDI input in its own panel outside sound output', () => {
    const { root, output } = createAppFixture();
    const input = root.querySelector<HTMLSelectElement>('#midi-input');
    const midiOutput = root.querySelector<HTMLSelectElement>('#midi-output');
    const panic = root.querySelector<HTMLElement>('#panic');

    expect(input).not.toBeNull();
    expect(input?.closest('.input-panel')).not.toBeNull();
    expect(input?.closest('.output-panel')).toBeNull();
    expect(root.querySelector('#midi-input-message')).not.toBeNull();
    expect(input?.closest('[hidden]')).toBeNull();
    expect(midiOutput?.closest('[hidden]')).not.toBeNull();
    expect(panic?.hidden).toBe(true);

    output.setMode('midi');
    expect(input?.closest('[hidden]')).toBeNull();
    expect(midiOutput?.closest('[hidden]')).toBeNull();
    expect(panic?.hidden).toBe(false);
  });

  it('labels output choices by the sound destination they select', () => {
    const { root } = createAppFixture();
    expect([...root.querySelectorAll<HTMLButtonElement>('[data-output]')]
      .map((button) => button.textContent)).toEqual(['Built-in voice', 'MIDI device']);
  });

});

describe('performance readout', () => {
  it('invites any performance when idle, including after releasing a MIDI note', () => {
    const { root, store } = createAppFixture();
    const current = root.querySelector<HTMLElement>('#currently-sounding')!;
    expect(current.textContent).toBe('Play a chord');

    store.dispatch({ type: 'press-note', owner: 'midi:61', note: 61, velocity: 90 });
    store.dispatch({ type: 'release', owner: 'midi:61' });
    expect(current.textContent).toBe('Play a chord');
  });

  it('shows chord name, Roman numeral, and notes and includes chords in recent progression', () => {
    const { root, store } = createAppFixture();
    store.dispatch({ type: 'press', owner: 'keyboard:a', degree: 1 });
    const current = root.querySelector<HTMLElement>('#currently-sounding')!;
    expect(current.textContent).toContain('C');
    expect(current.textContent).toContain('I');
    expect(current.textContent).toContain('C3');
    expect(root.querySelector('#history-names')?.textContent).toContain('C');
    expect(root.querySelector('#history-romans')?.textContent).toContain('I');
  });

  it('labels literal MIDI 61 as passthrough and leaves recent progression chord-only', () => {
    const { root, store } = createAppFixture();
    store.dispatch({ type: 'press-note', owner: 'midi:61', note: 61, velocity: 90 });
    const current = root.querySelector<HTMLElement>('#currently-sounding')!;
    expect(current.textContent).toContain('C#4');
    expect(current.textContent?.match(/C#4/g)).toHaveLength(1);
    expect(current.textContent).toContain('MIDI 61');
    expect(current.textContent).toContain('Passthrough');
    expect(root.querySelector('#history-names')?.textContent).toBe('No chords yet');
    expect(root.querySelector('#history-romans')?.textContent).toBe('');
  });
});

describe('gamepad status', () => {
  it('shows activation, then dismisses the ready notification after two seconds', () => {
    const label = { textContent: '' };
    const target = {
      dataset: {},
      hidden: true,
      querySelector: () => label,
    } as unknown as HTMLElement;
    let dismiss: (() => void) | null = null;
    const notification = new GamepadNotification(
      target,
      (callback, delay) => { expect(delay).toBe(2000); dismiss = callback; return 1; },
      () => {},
    );

    notification.update('activating');
    expect(target.hidden).toBe(false);
    expect(label.textContent).toBe('Release controller buttons');

    notification.update('ready');
    expect(target.hidden).toBe(false);
    expect(label.textContent).toBe('Controller ready');
    expect(dismiss).not.toBeNull();
    (dismiss as unknown as () => void)();
    expect(target.hidden).toBe(true);
  });

  it('cancels a pending dismissal when the controller disconnects', () => {
    const target = {
      dataset: {},
      hidden: true,
      querySelector: () => ({ textContent: '' }),
    } as unknown as HTMLElement;
    const cleared: number[] = [];
    const notification = new GamepadNotification(target, () => 7, (id) => cleared.push(id));

    notification.update('ready');
    notification.update('hidden');

    expect(cleared).toEqual([7]);
    expect(target.hidden).toBe(true);
  });
});

describe('voice waveform selection', () => {
  it('applies the waveform', () => {
    const select = { value: 'square' } as HTMLSelectElement;
    const values: string[] = [];

    commitVoiceSelection(select, (value) => values.push(value));

    expect(values).toEqual(['square']);
  });
});
