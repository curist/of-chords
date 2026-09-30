// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { OutputView } from './output-view';
import type { MidiOutputSnapshot, WebMidiOutputManager } from '../midi/midi-output';
import type { OutputController, OutputSnapshot } from '../output/output-controller';
import type { WebMidiAccess } from '../midi/midi-access';

const idleMidi: MidiOutputSnapshot = {
  status: 'idle', message: 'MIDI access has not been requested.', outputs: [],
  selectedOutputId: null, preferredOutputId: null, preferredOutputLabel: null,
};
const connectedMidi: MidiOutputSnapshot = {
  status: 'ready', message: 'Connected to Synth.',
  outputs: [{ id: 'synth', name: 'Synth', manufacturer: 'Acme', state: 'connected' }],
  selectedOutputId: 'synth', preferredOutputId: 'synth', preferredOutputLabel: 'Synth · Acme',
};

function createFixture() {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  root.innerHTML = `
    <div id="output-status-pill"><span></span><b>Built-in voice</b></div>
    <p id="output-message"></p>
    <div id="output-mode"><button data-output="builtin">Built-in voice</button><button data-output="midi">MIDI device</button></div>
    <button id="panic" data-output-panel="midi">Panic · All Notes Off</button>
    <div class="output-midi" data-output-panel="midi"><select id="midi-output"><option value="">No output selected</option></select></div>
    <section class="voice-panel">Voice tuning</section>`;
  vi.stubGlobal('Option', function Option(label: string, value: string) {
    const option = document.createElement('option');
    option.textContent = label;
    option.value = value;
    return option;
  });
  let midiListener: (snapshot: MidiOutputSnapshot) => void = () => {};
  let outputListener: (snapshot: OutputSnapshot) => void = () => {};
  const unsubscribeMidi = vi.fn();
  const unsubscribeOutput = vi.fn();
  const events: string[] = [];
  const midi = {
    selectOutput: vi.fn(),
    subscribe(callback: (snapshot: MidiOutputSnapshot) => void) {
      midiListener = callback;
      callback(idleMidi);
      return unsubscribeMidi;
    },
  };
  const output = {
    setMode: vi.fn((mode: string) => events.push(`select-${mode}`)),
    subscribe(callback: (snapshot: OutputSnapshot) => void) {
      outputListener = callback;
      callback({ mode: 'builtin' });
      return unsubscribeOutput;
    },
  };
  const access = { initialize: vi.fn(async () => { events.push('request-midi'); }) };
  const view = new OutputView(root, output as unknown as OutputController,
    midi as unknown as WebMidiOutputManager, access as Pick<WebMidiAccess, 'initialize'>);
  return { root, midi, output, access, view, events, unsubscribeMidi, unsubscribeOutput,
    emitMidi: (snapshot: MidiOutputSnapshot) => midiListener(snapshot),
    emitOutput: (snapshot: OutputSnapshot) => outputListener(snapshot) };
}

describe('OutputView', () => {
  it('cleans MIDI subscription and DOM listeners when output subscription throws', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    root.innerHTML = `<div id="output-status-pill"><b></b></div><p id="output-message"></p>
      <div id="output-mode"><button data-output="builtin">Built-in voice</button><button data-output="midi">MIDI device</button></div>
      <button id="panic" data-output-panel="midi">Panic</button>
      <div class="output-midi" data-output-panel="midi"><select id="midi-output"><option value="">No output selected</option><option value="synth">Synth</option></select></div>`;
    vi.stubGlobal('Option', function Option(label: string, value: string) {
      const option = document.createElement('option');
      option.textContent = label;
      option.value = value;
      return option;
    });
    const unsubscribeMidi = vi.fn();
    let emitMidi: (snapshot: MidiOutputSnapshot) => void = () => {};
    const midi = {
      selectOutput: vi.fn(),
      subscribe(listener: (snapshot: MidiOutputSnapshot) => void) {
        emitMidi = listener;
        return unsubscribeMidi;
      },
    };
    const output = { setMode: vi.fn(), subscribe: () => { throw new Error('output subscribe failed'); } };
    const access = { initialize: vi.fn(async () => {}) };

    expect(() => new OutputView(root, output as unknown as OutputController,
      midi as unknown as WebMidiOutputManager, access)).toThrow('output subscribe failed');
    const select = root.querySelector<HTMLSelectElement>('#midi-output')!;
    select.value = 'synth';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-output="midi"]')!.click();
    emitMidi(connectedMidi);
    expect(select.value).toBe('synth');
    expect(select.options).toHaveLength(2);
    expect(midi.selectOutput).not.toHaveBeenCalled();
    expect(output.setMode).not.toHaveBeenCalled();
    expect(access.initialize).not.toHaveBeenCalled();
    expect(unsubscribeMidi).toHaveBeenCalledOnce();
  });

  it('requests MIDI access before selecting MIDI mode and ignores invalid modes', () => {
    const { root, events, output, access } = createFixture();
    const button = root.querySelector<HTMLButtonElement>('[data-output="midi"]')!;
    button.click();
    expect(events).toEqual(['request-midi', 'select-midi']);
    button.dataset.output = '__proto__';
    button.click();
    expect(output.setMode).toHaveBeenCalledOnce();
    expect(access.initialize).toHaveBeenCalledOnce();
  });

  it('shows MIDI panels and mode selection only in MIDI mode', () => {
    const { root, emitOutput } = createFixture();
    const midiButton = root.querySelector<HTMLButtonElement>('[data-output="midi"]')!;
    const builtinButton = root.querySelector<HTMLButtonElement>('[data-output="builtin"]')!;
    const midiPanel = root.querySelector<HTMLElement>('.output-midi')!;
    const panic = root.querySelector<HTMLElement>('#panic')!;
    const voicePanel = root.querySelector<HTMLElement>('.voice-panel')!;
    expect(builtinButton.classList.contains('selected')).toBe(true);
    expect(midiPanel.hidden).toBe(true);
    expect(panic.hidden).toBe(true);
    expect(voicePanel.hidden).toBe(false);
    emitOutput({ mode: 'midi' });
    expect(midiButton.classList.contains('selected')).toBe(true);
    expect(builtinButton.classList.contains('selected')).toBe(false);
    expect(midiPanel.hidden).toBe(false);
    expect(panic.hidden).toBe(false);
    expect(voicePanel.hidden).toBe(true);
  });

  it('renders connected and disconnected output choices and routes selection', () => {
    const { root, midi, emitMidi } = createFixture();
    const select = root.querySelector<HTMLSelectElement>('#midi-output')!;
    emitMidi(connectedMidi);
    expect([...select.options].map((option) => option.value)).toEqual(['', 'synth']);
    expect(select.selectedOptions[0].textContent).toBe('Synth · Acme (connected)');
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.value = 'synth';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(midi.selectOutput.mock.calls).toEqual([[null], ['synth']]);
    emitMidi({ ...connectedMidi, message: 'MIDI ready. Select an output.', outputs: [], selectedOutputId: null });
    expect(select.value).toBe('synth');
    expect(select.selectedOptions[0].textContent).toBe('Synth · Acme (disconnected)');
  });

  it('renders built-in and MIDI status copy and pill state', () => {
    const { root, emitMidi, emitOutput } = createFixture();
    const pill = root.querySelector<HTMLElement>('#output-status-pill')!;
    const message = root.querySelector<HTMLElement>('#output-message')!;
    expect(pill.dataset.status).toBe('ready');
    expect(pill.textContent).toBe('Built-in voice');
    expect(message.textContent).toBe('Playing the built-in voice.');
    emitOutput({ mode: 'midi' });
    emitMidi(connectedMidi);
    expect(pill.dataset.status).toBe('ready');
    expect(pill.textContent).toBe('MIDI Out · Synth');
    expect(message.textContent).toBe('Connected to Synth.');
    emitMidi({ ...connectedMidi, message: 'Preferred MIDI output disconnected.', outputs: [], selectedOutputId: null });
    expect(pill.dataset.status).toBe('disconnected');
    expect(pill.textContent).toBe('MIDI Out');
    expect(message.textContent).toBe('Preferred MIDI output disconnected.');
  });

  it('updates cached nodes after they are removed from the root', () => {
    const { root, emitMidi, emitOutput } = createFixture();
    const pill = root.querySelector<HTMLElement>('#output-status-pill')!;
    const message = root.querySelector<HTMLElement>('#output-message')!;
    pill.remove();
    message.remove();
    emitOutput({ mode: 'midi' });
    emitMidi(connectedMidi);
    expect(pill.textContent).toBe('MIDI Out · Synth');
    expect(message.textContent).toBe('Connected to Synth.');
  });

  it('ignores source emissions and DOM events after repeated disposal', () => {
    const { root, midi, output, access, view, emitMidi, emitOutput, unsubscribeMidi, unsubscribeOutput } = createFixture();
    const message = root.querySelector<HTMLElement>('#output-message')!;
    view.dispose();
    view.dispose();
    emitOutput({ mode: 'midi' });
    emitMidi(connectedMidi);
    root.querySelector<HTMLButtonElement>('[data-output="midi"]')!.click();
    root.querySelector<HTMLSelectElement>('#midi-output')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(message.textContent).toBe('Playing the built-in voice.');
    expect(output.setMode).not.toHaveBeenCalled();
    expect(midi.selectOutput).not.toHaveBeenCalled();
    expect(access.initialize).not.toHaveBeenCalled();
    expect(unsubscribeMidi).toHaveBeenCalledOnce();
    expect(unsubscribeOutput).toHaveBeenCalledOnce();
  });
});
