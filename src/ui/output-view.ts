import { CleanupStack } from '../lifecycle/cleanup-stack';
import type { WebMidiAccess } from '../midi/midi-access';
import type { MidiOutputSnapshot, WebMidiOutputManager } from '../midi/midi-output';
import type { OutputController, OutputMode, OutputSnapshot } from '../output/output-controller';
import { parseOutputMode, requireElement } from './dom';

export class OutputView {
  readonly #cleanup = new CleanupStack();
  readonly #modeControl: HTMLElement;
  readonly #modeButtons: readonly HTMLButtonElement[];
  readonly #panels: readonly HTMLElement[];
  readonly #voicePanel: HTMLElement | null;
  readonly #select: HTMLSelectElement;
  readonly #message: HTMLElement;
  readonly #pill: HTMLElement;
  readonly #pillLabel: HTMLElement;
  #latestMidi: MidiOutputSnapshot | null = null;
  #mode: OutputMode = 'builtin';

  constructor(
    root: HTMLElement,
    private readonly output: OutputController,
    private readonly midi: WebMidiOutputManager,
    private readonly midiAccess: Pick<WebMidiAccess, 'initialize'>,
  ) {
    this.#modeControl = requireElement(root, '#output-mode');
    this.#modeButtons = [
      requireElement(this.#modeControl, '[data-output="builtin"]'),
      requireElement(this.#modeControl, '[data-output="midi"]'),
    ];
    this.#panels = [
      requireElement(root, '#panic'),
      requireElement(root, '.output-midi'),
    ];
    this.#voicePanel = root.querySelector<HTMLElement>('.voice-panel');
    this.#select = requireElement(root, '#midi-output');
    this.#message = requireElement(root, '#output-message');
    this.#pill = requireElement(root, '#output-status-pill');
    this.#pillLabel = requireElement(this.#pill, 'b');
    try {
      this.#listen(this.#modeControl, 'click', (event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-output]') : null;
        const mode = parseOutputMode(button?.dataset.output ?? '');
        if (mode === null) return;
        if (mode === 'midi') void this.midiAccess.initialize();
        this.output.setMode(mode);
      });
      this.#listen(this.#select, 'change', () => this.midi.selectOutput(this.#select.value || null));
      this.#cleanup.add(this.midi.subscribe((snapshot) => {
        if (!this.#cleanup.disposed) this.#renderMidi(snapshot);
      }));
      this.#cleanup.add(this.output.subscribe((snapshot) => {
        if (!this.#cleanup.disposed) this.#renderOutput(snapshot);
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

  #renderMidi(snapshot: MidiOutputSnapshot): void {
    this.#latestMidi = snapshot;
    const outputOptions = snapshot.outputs.map((output) => new Option(
      `${output.name}${output.manufacturer ? ` · ${output.manufacturer}` : ''}${output.id === snapshot.selectedOutputId ? ' (connected)' : ''}`,
      output.id,
    ));
    if (snapshot.preferredOutputId && !snapshot.outputs.some((output) => output.id === snapshot.preferredOutputId)) {
      outputOptions.push(new Option(
        `${snapshot.preferredOutputLabel ?? snapshot.preferredOutputId} (disconnected)`,
        snapshot.preferredOutputId,
      ));
    }
    this.#select.replaceChildren(new Option('No output selected', ''), ...outputOptions);
    this.#select.value = snapshot.preferredOutputId ?? '';
    this.#select.disabled = snapshot.status !== 'ready'
      || (snapshot.outputs.length === 0 && snapshot.preferredOutputId === null);
    this.#renderStatus();
  }

  #renderOutput(snapshot: OutputSnapshot): void {
    this.#mode = snapshot.mode;
    for (const button of this.#modeButtons) {
      button.classList.toggle('selected', button.dataset.output === snapshot.mode);
    }
    for (const panel of this.#panels) {
      const panelMode = parseOutputMode(panel.dataset.outputPanel ?? '');
      if (panelMode !== null) panel.hidden = panelMode !== snapshot.mode;
    }
    if (this.#voicePanel) this.#voicePanel.hidden = snapshot.mode !== 'builtin';
    this.#renderStatus();
  }

  #renderStatus(): void {
    if (this.#mode === 'builtin') {
      this.#pill.dataset.status = 'ready';
      this.#pillLabel.textContent = 'Built-in voice';
      this.#message.textContent = 'Playing the built-in voice.';
      return;
    }
    const midi = this.#latestMidi;
    const selected = midi?.outputs.find((output) => output.id === midi.selectedOutputId);
    const disconnected = midi?.status === 'ready'
      && midi.preferredOutputId !== null
      && midi.selectedOutputId === null;
    this.#pill.dataset.status = disconnected ? 'disconnected' : midi?.status ?? 'idle';
    let label = midi?.status === 'ready' && !disconnected ? 'MIDI Out ready' : 'MIDI Out';
    if (selected) label = `MIDI Out · ${selected.name}`;
    this.#pillLabel.textContent = label;
    this.#message.textContent = midi?.message ?? 'Requesting MIDI access…';
  }
}
