// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { App, commitModeSelection, commitProgramSelection, commitTonicSelection, commitVoiceSelection, GamepadNotification, isOutputPanelVisible } from './app';
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
  let outputListener: (snapshot: MidiOutputSnapshot) => void = () => {};
  const midi = {
    initialize: vi.fn(async () => {}),
    selectOutput: vi.fn(),
    subscribe(listener: (snapshot: MidiOutputSnapshot) => void) { outputListener = listener; listener(outputSnapshot); return () => {}; },
    noteOn() {}, noteOff() {}, allNotesOff() {}, programChange() {},
  };
  const output = new OutputController(synth, midi, { storage: null });
  const store = new InstrumentStore({ acquire() {}, release() {}, panic() {}, programChange() {} });
  let inputListener: (snapshot: MidiInputSnapshot) => void = () => {};
  const initialInput: MidiInputSnapshot = {
    status: 'idle', message: 'MIDI access has not been requested.', inputs: [], preferredInputId: null, attachedInputId: null,
  };
  const input = {
    selectInput: vi.fn(), resume: vi.fn(),
    subscribe(listener: (snapshot: MidiInputSnapshot) => void) { inputListener = listener; listener(initialInput); return () => {}; },
  };
  const access = { initialize: vi.fn(async () => {}) };
  new App(root, store, midi as unknown as WebMidiOutputManager, output, synth,
    input as unknown as WebMidiInputManager, access as unknown as WebMidiAccess);
  return {
    root, store, output, input, access,
    emitOutput(snapshot: MidiOutputSnapshot) { outputListener(snapshot); },
    emitInput(snapshot: MidiInputSnapshot) { inputListener(snapshot); },
  };
}

const readyInput: MidiInputSnapshot = {
  status: 'ready', message: 'Connected to Keyboard.',
  inputs: [
    { id: 'keyboard', name: 'Keyboard', manufacturer: 'Acme', state: 'connected' },
    { id: 'pads', name: 'Pads', manufacturer: '', state: 'connected' },
  ],
  preferredInputId: 'keyboard', attachedInputId: 'keyboard',
};

describe('tonic selection', () => {
  it('dispatches the selected tonic and returns focus to the instrument', () => {
    const blur = vi.fn();
    const select = { value: '7', blur } as unknown as HTMLSelectElement;
    const actions: InstrumentAction[] = [];

    commitTonicSelection(select, (action) => actions.push(action));

    expect(actions).toEqual([{ type: 'set-tonic', tonic: 7 }]);
    expect(blur).toHaveBeenCalledOnce();
  });
});

describe('mode selection', () => {
  it('dispatches the selected mode and returns focus to the instrument', () => {
    const blur = vi.fn();
    const select = { value: 'naturalMinor', blur } as unknown as HTMLSelectElement;
    const actions: InstrumentAction[] = [];

    commitModeSelection(select, (action) => actions.push(action));

    expect(actions).toEqual([{ type: 'set-mode', mode: 'naturalMinor' }]);
    expect(blur).toHaveBeenCalledOnce();
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
});

describe('output-specific controls', () => {
  it('shows MIDI controls only while MIDI is selected', () => {
    expect(isOutputPanelVisible('midi', 'midi')).toBe(true);
    expect(isOutputPanelVisible('midi', 'builtin')).toBe(false);
  });

  it('requests MIDI access when MIDI output is selected', async () => {
    const appModule = await import('./app');
    const activateOutputMode = (appModule as unknown as {
      activateOutputMode?: (
        mode: 'builtin' | 'midi',
        midi: { initialize(): Promise<void> },
        output: { setMode(mode: 'builtin' | 'midi'): void },
      ) => void;
    }).activateOutputMode;
    const events: string[] = [];

    activateOutputMode?.(
      'midi',
      { async initialize() { events.push('request-midi'); } },
      { setMode(mode) { events.push(`select-${mode}`); } },
    );

    expect(events).toEqual(['request-midi', 'select-midi']);
  });
});

describe('MIDI input controls', () => {
  it('keeps input controls visible across output modes while output controls follow MIDI mode', () => {
    const { root, output } = createAppFixture();
    const input = root.querySelector<HTMLSelectElement>('#midi-input');
    const midiOutput = root.querySelector<HTMLSelectElement>('#midi-output');
    const panic = root.querySelector<HTMLElement>('#panic');

    expect(input).not.toBeNull();
    expect(root.querySelector('#midi-input-message')).toBeNull();
    expect(input?.closest('[hidden]')).toBeNull();
    expect(midiOutput?.closest('[hidden]')).not.toBeNull();
    expect(panic?.hidden).toBe(true);

    output.setMode('midi');
    expect(input?.closest('[hidden]')).toBeNull();
    expect(midiOutput?.closest('[hidden]')).toBeNull();
    expect(panic?.hidden).toBe(false);
  });

  it('places MIDI input, MIDI output, and program controls in that order in one row', () => {
    const { root } = createAppFixture();
    const row = root.querySelector<HTMLElement>('.midi-device-controls')!;
    expect([...row.querySelectorAll('select')].map((select) => select.id)).toEqual(['midi-input', 'midi-output']);
    expect([...row.children].map((element) => element.className)).toEqual([
      'output-input-controls', '', 'program-controls',
    ]);
  });

  it('renders connected, detached, requesting, and suspended input states', () => {
    const { root, emitInput } = createAppFixture();
    const select = root.querySelector<HTMLSelectElement>('#midi-input')!;
    const action = root.querySelector<HTMLButtonElement>('#midi-input-action')!;

    emitInput(readyInput);
    expect([...select.options].map((option) => option.value)).toEqual(['', 'keyboard', 'pads']);
    expect(select.value).toBe('keyboard');
    expect(select.selectedOptions[0].textContent).toContain('connected');
    expect(select.disabled).toBe(false);
    expect(action.hidden).toBe(true);

    emitInput({ ...readyInput, status: 'disconnected', message: 'Preferred MIDI input disconnected.',
      inputs: [readyInput.inputs[1]], attachedInputId: null });
    expect(select.value).toBe('keyboard');
    expect(select.selectedOptions[0].textContent).toContain('disconnected');

    emitInput({ ...readyInput, status: 'requesting', message: 'Requesting MIDI access…', attachedInputId: null });
    expect(select.disabled).toBe(true);

    emitInput({ ...readyInput, status: 'suspended', message: 'Possible MIDI feedback loop detected. Check MIDI routing, then resume input.', attachedInputId: null });
    expect(select.value).toBe('keyboard');
    expect(action.hidden).toBe(false);
    expect(action.textContent).toContain('Resume');
  });

  it('selects devices and No input through real change events', () => {
    const { root, input, emitInput } = createAppFixture();
    emitInput(readyInput);
    const select = root.querySelector<HTMLSelectElement>('#midi-input')!;
    select.value = 'pads';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(input.selectInput.mock.calls).toEqual([['pads'], [null]]);
  });

  it('connects shared access from a click and resumes a suspended preferred input', () => {
    const { root, input, access, emitInput } = createAppFixture();
    const action = root.querySelector<HTMLButtonElement>('#midi-input-action')!;
    action.click();
    expect(access.initialize).toHaveBeenCalledOnce();
    emitInput({ ...readyInput, status: 'suspended', message: 'Possible MIDI feedback loop detected.', attachedInputId: null });
    expect(root.querySelector<HTMLSelectElement>('#midi-input')?.value).toBe('keyboard');
    action.click();
    expect(input.resume).toHaveBeenCalledOnce();
    expect(access.initialize).toHaveBeenCalledOnce();
  });
});

describe('MIDI output controls', () => {
  it('marks the attached output and keeps a disconnected preferred output visible', () => {
    const { root, emitOutput } = createAppFixture();
    const select = root.querySelector<HTMLSelectElement>('#midi-output')!;
    emitOutput({
      status: 'ready', message: 'Connected to Synth.',
      outputs: [{ id: 'synth', name: 'Synth', manufacturer: 'Acme', state: 'connected' }],
      selectedOutputId: 'synth', preferredOutputId: 'synth', preferredOutputLabel: 'Synth · Acme',
    });
    expect(select.selectedOptions[0].textContent).toBe('Synth · Acme (connected)');

    emitOutput({
      status: 'ready', message: 'MIDI ready. Select an output.', outputs: [],
      selectedOutputId: null, preferredOutputId: 'synth', preferredOutputLabel: 'Synth · Acme',
    });
    expect(select.value).toBe('synth');
    expect(select.selectedOptions[0].textContent).toBe('Synth · Acme (disconnected)');
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
  it('applies the waveform and returns focus to the instrument', () => {
    const blur = vi.fn();
    const select = { value: 'square', blur } as unknown as HTMLSelectElement;
    const values: string[] = [];

    commitVoiceSelection(select, (value) => values.push(value));

    expect(values).toEqual(['square']);
    expect(blur).toHaveBeenCalledOnce();
  });
});
