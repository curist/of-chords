// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { App, commitVoiceSelection, GamepadNotification } from './app';
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

describe('DOM event boundaries', () => {
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

  it('commits valid output values through their events', () => {
    const { root, output, access } = createAppFixture();
    root.querySelector<HTMLButtonElement>('[data-output="midi"]')!.click();
    expect(output.mode).toBe('midi');
    expect(access.initialize).toHaveBeenCalledOnce();
  });

  it('commits valid voice values through their events', () => {
    const { root, synth } = createAppFixture();
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
