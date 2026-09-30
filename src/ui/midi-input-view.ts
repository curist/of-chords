import { CleanupStack } from '../lifecycle/cleanup-stack';
import type { WebMidiAccess } from '../midi/midi-access';
import type { MidiInputSnapshot, WebMidiInputManager } from '../midi/midi-input';
import { requireElement } from './dom';

export class MidiInputView {
  readonly #cleanup = new CleanupStack();
  readonly #select: HTMLSelectElement;
  readonly #action: HTMLButtonElement;
  readonly #message: HTMLElement;
  readonly #pill: HTMLElement;
  readonly #pillLabel: HTMLElement;
  #latest: MidiInputSnapshot | null = null;

  constructor(
    root: HTMLElement,
    private readonly midiInput: WebMidiInputManager,
    private readonly midiAccess: Pick<WebMidiAccess, 'initialize'>,
  ) {
    this.#select = requireElement(root, '#midi-input');
    this.#action = requireElement(root, '#midi-input-action');
    this.#message = requireElement(root, '#midi-input-message');
    this.#pill = requireElement(root, '#input-status-pill');
    this.#pillLabel = requireElement(this.#pill, 'b');
    try {
      this.#listen(this.#select, 'change', () => this.midiInput.selectInput(this.#select.value || null));
      this.#listen(this.#action, 'click', () => {
        if (this.#latest?.status === 'suspended') this.midiInput.resume();
        else void this.midiAccess.initialize();
      });
      this.#cleanup.add(this.midiInput.subscribe((snapshot) => {
        if (!this.#cleanup.disposed) this.#render(snapshot);
      }));
    } catch (error) {
      this.#cleanup.dispose();
      throw error;
    }
  }

  dispose(): void {
    this.#cleanup.dispose();
  }

  #listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.#cleanup.add(() => target.removeEventListener(type, listener));
  }

  #render(snapshot: MidiInputSnapshot): void {
    this.#latest = snapshot;
    const emptyOption = new Option('No input', '');
    const inputOptions = snapshot.inputs.map((input) => new Option(
      `${input.name}${input.manufacturer ? ` · ${input.manufacturer}` : ''}${input.id === snapshot.attachedInputId ? ' (connected)' : ''}`,
      input.id,
    ));
    if (snapshot.preferredInputId && !snapshot.inputs.some((input) => input.id === snapshot.preferredInputId)) {
      inputOptions.push(new Option(
        `${snapshot.preferredInputLabel ?? snapshot.preferredInputId} (disconnected)`,
        snapshot.preferredInputId,
      ));
    }
    this.#select.replaceChildren(emptyOption, ...inputOptions);
    this.#select.value = snapshot.preferredInputId ?? '';
    this.#select.disabled = (snapshot.status !== 'ready' && snapshot.status !== 'disconnected')
      || (snapshot.inputs.length === 0 && snapshot.preferredInputId === null);

    this.#action.hidden = snapshot.status === 'ready' || snapshot.status === 'disconnected'
      || snapshot.status === 'requesting' || snapshot.status === 'unsupported';
    this.#action.textContent = snapshot.status === 'suspended' ? 'Resume input' : 'Connect input';

    this.#message.textContent = snapshot.message;
    const attached = snapshot.inputs.find((input) => input.id === snapshot.attachedInputId);
    this.#pill.hidden = snapshot.preferredInputId === null && snapshot.attachedInputId === null;
    this.#pill.dataset.status = snapshot.status;
    this.#pillLabel.textContent = snapshot.status === 'suspended'
      ? 'MIDI In suspended'
      : attached ? `MIDI In · ${attached.name}` : 'MIDI In';
  }
}
