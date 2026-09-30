// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { MidiInputView } from './midi-input-view';
import type { MidiInputSnapshot, WebMidiInputManager } from '../midi/midi-input';
import type { WebMidiAccess } from '../midi/midi-access';

const readyInput: MidiInputSnapshot = {
  status: 'ready', message: 'Connected to Keyboard.',
  inputs: [
    { id: 'keyboard', name: 'Keyboard', manufacturer: 'Acme', state: 'connected' },
    { id: 'pads', name: 'Pads', manufacturer: '', state: 'connected' },
  ],
  preferredInputId: 'keyboard', preferredInputLabel: 'Keyboard · Acme', attachedInputId: 'keyboard',
};

function createFixture() {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  root.innerHTML = `
    <div id="input-status-pill" hidden><span></span><b></b></div>
    <section class="input-panel">
      <p id="midi-input-message"></p>
      <select id="midi-input"><option value="">No input</option></select>
      <button id="midi-input-action">Connect input</button>
    </section>`;
  vi.stubGlobal('Option', function Option(label: string, value: string) {
    const option = document.createElement('option');
    option.textContent = label;
    option.value = value;
    return option;
  });
  let listener: (snapshot: MidiInputSnapshot) => void = () => {};
  const unsubscribe = vi.fn();
  const input = {
    selectInput: vi.fn(), resume: vi.fn(),
    subscribe(callback: (snapshot: MidiInputSnapshot) => void) {
      listener = callback;
      callback({ status: 'idle', message: 'MIDI access has not been requested.', inputs: [],
        preferredInputId: null, preferredInputLabel: null, attachedInputId: null });
      return unsubscribe;
    },
  };
  const access = { initialize: vi.fn(async () => {}) };
  const view = new MidiInputView(root, input as unknown as WebMidiInputManager, access as Pick<WebMidiAccess, 'initialize'>);
  return { root, input, access, view, unsubscribe, emit: (snapshot: MidiInputSnapshot) => listener(snapshot) };
}

describe('MidiInputView', () => {
  it('removes DOM listeners when input subscription throws during construction', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    root.innerHTML = `<div id="input-status-pill"><b></b></div>
      <p id="midi-input-message"></p><select id="midi-input"><option value="">No input</option><option value="pads">Pads</option></select>
      <button id="midi-input-action">Connect input</button>`;
    const input = { selectInput: vi.fn(), resume: vi.fn(), subscribe: () => { throw new Error('input subscribe failed'); } };
    const access = { initialize: vi.fn(async () => {}) };

    expect(() => new MidiInputView(root, input as unknown as WebMidiInputManager, access)).toThrow('input subscribe failed');
    const select = root.querySelector<HTMLSelectElement>('#midi-input')!;
    select.value = 'pads';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('#midi-input-action')!.click();
    expect(input.selectInput).not.toHaveBeenCalled();
    expect(access.initialize).not.toHaveBeenCalled();
  });

  it('renders connected, disconnected, requesting, and suspended input states', () => {
    const { root, emit } = createFixture();
    const select = root.querySelector<HTMLSelectElement>('#midi-input')!;
    const action = root.querySelector<HTMLButtonElement>('#midi-input-action')!;
    const pill = root.querySelector<HTMLElement>('#input-status-pill')!;

    emit(readyInput);
    expect([...select.options].map((option) => option.value)).toEqual(['', 'keyboard', 'pads']);
    expect(select.value).toBe('keyboard');
    expect(select.selectedOptions[0].textContent).toBe('Keyboard · Acme (connected)');
    expect(select.disabled).toBe(false);
    expect(action.hidden).toBe(true);
    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toBe('MIDI In · Keyboard');

    emit({ ...readyInput, status: 'disconnected', message: 'Preferred MIDI input disconnected.',
      inputs: [readyInput.inputs[1]], attachedInputId: null });
    expect(select.value).toBe('keyboard');
    expect(select.selectedOptions[0].textContent).toBe('Keyboard · Acme (disconnected)');
    expect(pill.dataset.status).toBe('disconnected');
    expect(pill.textContent).toBe('MIDI In');

    emit({ ...readyInput, status: 'requesting', message: 'Requesting MIDI access…', attachedInputId: null });
    expect(select.disabled).toBe(true);
    expect(action.hidden).toBe(true);

    emit({ ...readyInput, status: 'suspended', message: 'Possible MIDI feedback loop detected.', attachedInputId: null });
    expect(select.value).toBe('keyboard');
    expect(action.hidden).toBe(false);
    expect(action.textContent).toBe('Resume input');
    expect(pill.textContent).toBe('MIDI In suspended');
    expect(root.querySelector('#midi-input-message')?.textContent).toBe('Possible MIDI feedback loop detected.');
  });

  it('selects devices and No input through change events', () => {
    const { root, input, emit } = createFixture();
    emit(readyInput);
    const select = root.querySelector<HTMLSelectElement>('#midi-input')!;
    select.value = 'pads';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(input.selectInput.mock.calls).toEqual([['pads'], [null]]);
  });

  it('connects shared access and resumes a suspended preferred input', () => {
    const { root, input, access, emit } = createFixture();
    const action = root.querySelector<HTMLButtonElement>('#midi-input-action')!;
    action.click();
    expect(access.initialize).toHaveBeenCalledOnce();
    emit({ ...readyInput, status: 'suspended', message: 'Possible MIDI feedback loop detected.', attachedInputId: null });
    action.click();
    expect(input.resume).toHaveBeenCalledOnce();
    expect(access.initialize).toHaveBeenCalledOnce();
  });

  it('ignores source emissions and DOM events after repeated disposal', () => {
    const { root, input, access, view, unsubscribe, emit } = createFixture();
    emit(readyInput);
    const select = root.querySelector<HTMLSelectElement>('#midi-input')!;
    const action = root.querySelector<HTMLButtonElement>('#midi-input-action')!;
    const message = root.querySelector<HTMLElement>('#midi-input-message')!;
    view.dispose();
    view.dispose();
    emit({ ...readyInput, status: 'suspended', message: 'Changed after dispose.' });
    select.value = 'pads';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    action.click();
    expect(message.textContent).toBe('Connected to Keyboard.');
    expect(input.selectInput).not.toHaveBeenCalled();
    expect(input.resume).not.toHaveBeenCalled();
    expect(access.initialize).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
