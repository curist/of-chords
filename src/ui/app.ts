import type { WebAudioSynthSink } from '../audio/synth';
import { DEFAULT_VOICE, parseVoiceParam, VOICE_PARAM_RANGES, WAVEFORMS, type VoiceParams } from '../audio/voice-params';
import { CHORD_BINDINGS } from '../config';
import { describeGamepadStatus, type GamepadInputStatus } from '../input/gamepad';
import { CleanupStack } from '../lifecycle/cleanup-stack';
import { parseChordShape, parseInversion, parseScaleDegree } from '../music/chords';
import { resolveChord } from '../music/harmony';
import { noteNames, parsePitchClass, TONIC_OPTIONS } from '../music/notes';
import { MODE_OPTIONS, parseMode } from '../music/scales';
import { voiceChord } from '../music/voicing';
import type { WebMidiAccess } from '../midi/midi-access';
import type { WebMidiInputManager } from '../midi/midi-input';
import type { WebMidiOutputManager } from '../midi/midi-output';
import type { OutputController } from '../output/output-controller';
import type { ActiveGesture, InstrumentAction, InstrumentState } from '../state/instrument';
import type { InstrumentStore } from '../state/store';
import { requireElement } from './dom';
import { MidiInputView } from './midi-input-view';
import { OutputView } from './output-view';

export function commitTonicSelection(
  select: HTMLSelectElement,
  dispatch: (action: InstrumentAction) => void,
): void {
  const tonic = parsePitchClass(select.value);
  if (tonic !== null) dispatch({ type: 'set-tonic', tonic });
}

export function commitModeSelection(
  select: HTMLSelectElement,
  dispatch: (action: InstrumentAction) => void,
): void {
  const mode = parseMode(select.value);
  if (mode !== null) dispatch({ type: 'set-mode', mode });
}

export function commitProgramSelection(
  input: HTMLInputElement,
  dispatch: (action: InstrumentAction) => void,
): void {
  const program = Number(input.value);
  if (input.value.trim() !== '' && Number.isInteger(program) && program >= 1 && program <= 128) {
    dispatch({ type: 'set-program', program: program - 1 });
  }
  input.blur();
}

export function commitVoiceSelection(
  select: HTMLSelectElement,
  apply: (value: string) => void,
): void {
  apply(select.value);
}

type ScheduleDismiss = (callback: () => void, delay: number) => number;
type CancelDismiss = (id: number) => void;

export class GamepadNotification {
  #dismissId: number | null = null;

  constructor(
    private readonly target: HTMLElement,
    private readonly scheduleDismiss: ScheduleDismiss = (callback, delay) => window.setTimeout(callback, delay),
    private readonly cancelDismiss: CancelDismiss = (id) => window.clearTimeout(id),
  ) {}

  update(status: GamepadInputStatus): void {
    if (this.#dismissId !== null) {
      this.cancelDismiss(this.#dismissId);
      this.#dismissId = null;
    }
    this.target.dataset.status = status;
    this.target.hidden = status === 'hidden';
    this.target.querySelector('b')!.textContent = describeGamepadStatus(status);
    if (status === 'ready') {
      this.#dismissId = this.scheduleDismiss(() => {
        this.target.hidden = true;
        this.#dismissId = null;
      }, 2000);
    }
  }

  dispose(): void {
    if (this.#dismissId === null) return;
    this.cancelDismiss(this.#dismissId);
    this.#dismissId = null;
  }
}

// The voice-tuning panel is for iterating on the built-in voice, so it only
// appears in dev (`npm run dev`), never in a production build.
const SHOW_VOICE_TUNING = import.meta.env.DEV;

export class App {
  readonly #cleanup = new CleanupStack();
  readonly #pointerOwners = new Map<number, string>();
  readonly #gamepadNotification: GamepadNotification;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: InstrumentStore,
    private readonly midi: WebMidiOutputManager,
    private readonly output: OutputController,
    private readonly synth: WebAudioSynthSink,
    private readonly midiInput: WebMidiInputManager,
    private readonly midiAccess: Pick<WebMidiAccess, 'initialize'>,
  ) {
    this.#renderShell();
    this.#gamepadNotification = new GamepadNotification(
      requireElement<HTMLElement>(this.root, '#gamepad-notification'),
    );
    this.#cleanup.add(() => this.#gamepadNotification.dispose());
    const midiInputView = new MidiInputView(this.root, this.midiInput, this.midiAccess);
    this.#cleanup.add(() => midiInputView.dispose());
    const outputView = new OutputView(this.root, this.output, this.midi, this.midiAccess);
    this.#cleanup.add(() => outputView.dispose());
    this.#bindControls();
    this.#cleanup.add(this.store.subscribe((state) => this.#renderInstrument(state)));
  }

  dispose(): void {
    this.#cleanup.dispose();
  }

  setGamepadStatus(status: GamepadInputStatus): void {
    this.#gamepadNotification.update(status);
  }

  #listen(target: EventTarget | null, type: string, listener: EventListener): void {
    if (!target) return;
    target.addEventListener(type, listener);
    this.#cleanup.add(() => target.removeEventListener(type, listener));
  }

  #renderShell(): void {
    this.root.innerHTML = `
      <main class="instrument">
        <header class="hero">
          <p class="eyebrow">Of Chords</p>
          <div class="header-statuses">
            <div class="status-pill" id="input-status-pill" hidden><span></span><b></b></div>
            <div class="status-pill" id="output-status-pill"><span></span><b>Built-in voice</b></div>
          </div>
        </header>
        <div class="controller-toast" id="gamepad-notification" data-status="hidden" role="status" aria-live="polite" hidden><span></span><b></b></div>

        <section class="panel setup" aria-labelledby="harmony-heading">
          <div>
            <p class="section-label" id="harmony-heading">Harmony</p>
            <label>Key<select id="tonic-select">${TONIC_OPTIONS.map(({ name, value }) => `<option value="${value}">${name}</option>`).join('')}</select></label>
            <label>Mode<select id="mode-select">${MODE_OPTIONS.map(({ name, value }) => `<option value="${value}">${name}</option>`).join('')}</select></label>
          </div>
          <div>
            <p class="section-label">Chord</p>
            <div class="segmented" id="shape-controls" aria-label="Chord shape">
              <button data-shape="triad">Triad</button><button data-shape="seventh">7th</button><button data-shape="sus2">sus2</button><button data-shape="sus4">sus4</button>
            </div>
          </div>
          <div>
            <p class="section-label">Inversion</p>
            <div class="segmented" id="inversion-controls" aria-label="Inversion">
              <button data-inversion="0">Root</button><button data-inversion="1">1st</button><button data-inversion="2">2nd</button>
            </div>
          </div>
        </section>

        <section class="play-section" aria-labelledby="chords-heading">
          <div class="section-heading"><div><p class="section-label">Play</p><h2 id="chords-heading">Diatonic chords</h2></div><p>Hold <kbd>A</kbd> through <kbd>J</kbd></p></div>
          <div class="chord-grid" id="chord-grid">
            ${CHORD_BINDINGS.map(({ degree, key }) => `
              <button class="chord-pad" data-degree="${degree}">
                <span class="roman"></span><kbd>${key}</kbd><strong></strong><small></small>
              </button>`).join('')}
          </div>
        </section>

        <section class="readout-grid">
          <article class="panel now" aria-live="polite">
            <p class="section-label">Currently sounding</p>
            <div id="currently-sounding" class="empty-state">Play a chord</div>
          </article>
          <article class="panel history">
            <p class="section-label">Recent progression</p>
            <div id="history-names" class="progression empty-state">No chords yet</div>
            <div id="history-romans" class="progression roman-line"></div>
          </article>
        </section>

        <section class="panel input-panel" aria-labelledby="input-heading">
          <div class="input-head">
            <div><p class="section-label">Input</p><h2 id="input-heading">Controller input</h2><p id="midi-input-message"></p></div>
            <div class="midi-input-controls">
              <label>MIDI Input<select id="midi-input"><option value="">No input</option></select></label>
              <button id="midi-input-action" type="button">Connect input</button>
            </div>
          </div>
        </section>

        <section class="panel output-panel" aria-labelledby="output-heading">
          <div class="output-head">
            <div><p class="section-label">Output</p><h2 id="output-heading">Sound output</h2><p id="output-message"></p></div>
            <div class="segmented" id="output-mode" aria-label="Sound output">
              <button data-output="builtin">Built-in voice</button><button data-output="midi">MIDI device</button>
            </div>
            <button id="panic" class="panic" data-output-panel="midi">Panic · All Notes Off</button>
          </div>

          <div class="output-midi" data-output-panel="midi">
            <div class="midi-device-controls">
              <label>MIDI Output<select id="midi-output"><option value="">No output selected</option></select></label>
              <div class="program-controls">
                <button id="previous-program" aria-label="Previous MIDI program"><span>←</span><kbd>[</kbd></button>
                <label>Program<input id="program-input" type="number" min="1" max="128" placeholder="—"></label>
                <button id="next-program" aria-label="Next MIDI program"><span>→</span><kbd>]</kbd></button>
              </div>
            </div>
          </div>
        </section>
        ${SHOW_VOICE_TUNING ? this.#renderDevPanelMarkup() : ''}
      </main>`;
  }

  #renderDevPanelMarkup(): string {
    const controls = VOICE_PARAM_RANGES.map((param) => {
      if (param.kind === 'waveform') {
        return `<label class="voice-field">${param.label}
          <select data-voice-param="${param.key}">${WAVEFORMS.map((wave) => `<option value="${wave}">${wave}</option>`).join('')}</select>
        </label>`;
      }
      return `<label class="voice-field">${param.label} <output data-voice-readout="${param.key}"></output>
        <input type="range" data-voice-param="${param.key}" min="${param.min}" max="${param.max}" step="${param.step}">
      </label>`;
    }).join('');
    return `
      <section class="panel voice-panel" aria-labelledby="voice-heading">
        <div class="voice-panel-head">
          <div><p class="section-label">Development</p><h2 id="voice-heading">Voice tuning</h2><p>Shapes newly played notes. Dev build only.</p></div>
          <button id="voice-reset" class="voice-reset">Reset defaults</button>
        </div>
        <div class="voice-grid">${controls}</div>
      </section>`;
  }

  #bindControls(): void {
    this.#listen(this.root, 'change', (event) => {
      if (event.target instanceof HTMLSelectElement) event.target.blur();
    });
    const tonic = requireElement<HTMLSelectElement>(this.root, '#tonic-select');
    this.#listen(tonic, 'change', () => {
      commitTonicSelection(tonic, (action) => this.store.dispatch(action));
    });
    const mode = requireElement<HTMLSelectElement>(this.root, '#mode-select');
    this.#listen(mode, 'change', () => {
      commitModeSelection(mode, (action) => this.store.dispatch(action));
    });
    this.#listen(requireElement(this.root, '#shape-controls'), 'click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-shape]') : null;
      const shape = parseChordShape(button?.dataset.shape ?? '');
      if (shape !== null) this.store.dispatch({ type: 'set-shape', shape });
    });
    this.#listen(requireElement(this.root, '#inversion-controls'), 'click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-inversion]') : null;
      const inversion = parseInversion(button?.dataset.inversion ?? '');
      if (inversion !== null) this.store.dispatch({ type: 'set-inversion', inversion });
    });
    const chordGrid = requireElement(this.root, '#chord-grid');
    this.#listen(chordGrid, 'pointerdown', (event) => {
      const pointer = event as PointerEvent;
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-degree]') : null;
      const degree = parseScaleDegree(button?.dataset.degree ?? '');
      if (!button || degree === null) return;
      event.preventDefault();
      button.setPointerCapture(pointer.pointerId);
      const owner = `pointer:${pointer.pointerId}`;
      this.#pointerOwners.set(pointer.pointerId, owner);
      this.store.dispatch({ type: 'press', owner, degree });
    });
    const releasePointer = (event: Event) => {
      const pointer = event as PointerEvent;
      const owner = this.#pointerOwners.get(pointer.pointerId);
      if (!owner) return;
      this.#pointerOwners.delete(pointer.pointerId);
      this.store.dispatch({ type: 'release', owner });
    };
    this.#listen(chordGrid, 'pointerup', releasePointer);
    this.#listen(chordGrid, 'pointercancel', releasePointer);
    this.#listen(requireElement(this.root, '#panic'), 'click', () => this.store.dispatch({ type: 'panic' }));
    if (SHOW_VOICE_TUNING) this.#bindDevPanel();
    this.#listen(requireElement(this.root, '#previous-program'), 'click', () => this.store.dispatch({ type: 'step-program', direction: -1 }));
    this.#listen(requireElement(this.root, '#next-program'), 'click', () => this.store.dispatch({ type: 'step-program', direction: 1 }));
    const programInput = requireElement<HTMLInputElement>(this.root, '#program-input');
    this.#listen(programInput, 'change', () => {
      commitProgramSelection(programInput, (action) => this.store.dispatch(action));
    });
  }

  #renderInstrument(state: InstrumentState): void {
    const tonic = this.root.querySelector<HTMLSelectElement>('#tonic-select');
    if (tonic) tonic.value = String(state.tonic);
    const mode = this.root.querySelector<HTMLSelectElement>('#mode-select');
    if (mode) mode.value = state.mode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach((button) => button.classList.toggle('selected', button.dataset.shape === state.shape));
    this.root.querySelectorAll<HTMLButtonElement>('[data-inversion]').forEach((button) => button.classList.toggle('selected', Number(button.dataset.inversion) === state.inversion));

    const activeDegrees = new Set(Object.values(state.active)
      .filter((gesture) => gesture.kind === 'chord')
      .map((chord) => chord.degree));
    this.root.querySelectorAll<HTMLButtonElement>('.chord-pad').forEach((button) => {
      const degree = parseScaleDegree(button.dataset.degree ?? '');
      if (degree === null) return;
      const chord = resolveChord({ tonic: state.tonic, mode: state.mode, degree, shape: state.shape, inversion: state.inversion });
      const notes = voiceChord(chord, state.register);
      button.querySelector('.roman')!.textContent = chord.roman;
      button.querySelector('strong')!.textContent = chord.name;
      button.querySelector('small')!.textContent = noteNames(chord.pitchClasses).join(' · ');
      button.classList.toggle('active', activeDegrees.has(degree));
      button.setAttribute('aria-pressed', String(activeDegrees.has(degree)));
      button.title = `MIDI ${notes.join(', ')}`;
    });

    const active = Object.values(state.active);
    const current = this.root.querySelector<HTMLElement>('#currently-sounding')!;
    current.classList.toggle('empty-state', active.length === 0);
    current.innerHTML = active.length === 0 ? 'Play a chord' : active.map((gesture) => this.#renderGesture(gesture)).join('');

    const historyNames = this.root.querySelector<HTMLElement>('#history-names')!;
    historyNames.classList.toggle('empty-state', state.history.length === 0);
    historyNames.textContent = state.history.length ? state.history.map((chord) => chord.name).join(' → ') : 'No chords yet';
    this.root.querySelector<HTMLElement>('#history-romans')!.textContent = state.history.map((chord) => chord.roman).join(' → ');

    const programInput = this.root.querySelector<HTMLInputElement>('#program-input')!;
    programInput.value = state.program === null ? '' : String(state.program + 1);
  }

  #renderGesture(gesture: ActiveGesture): string {
    if (gesture.kind === 'literal') {
      return `<div class="sounding-chord"><div><strong>${gesture.name}</strong><span>Passthrough</span></div><p><small>MIDI ${gesture.note}</small></p></div>`;
    }
    return `<div class="sounding-chord"><div><strong>${gesture.name}</strong><span>${gesture.roman}</span></div><p>${gesture.noteNames.join(' &nbsp; ')}<small>MIDI ${gesture.notes.join(' · ')}</small></p></div>`;
  }

  #bindDevPanel(): void {
    this.#listen(requireElement(this.root, '.voice-panel'), 'input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      const params = parseVoiceParam(target.dataset.voiceParam ?? '', target.value);
      if (params === null) return;
      this.synth.setParams(params);
      this.#renderVoiceParams(this.synth.params);
    });
    this.#listen(requireElement(this.root, '#voice-reset'), 'click', () => {
      this.synth.setParams(DEFAULT_VOICE);
      this.#renderVoiceParams(DEFAULT_VOICE);
    });
    this.#renderVoiceParams(this.synth.params);
  }

  #renderVoiceParams(params: VoiceParams): void {
    for (const param of VOICE_PARAM_RANGES) {
      const value = params[param.key];
      const control = this.root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-voice-param="${param.key}"]`);
      if (control) control.value = String(value);
      if (param.kind === 'range') {
        const readout = this.root.querySelector<HTMLOutputElement>(`[data-voice-readout="${param.key}"]`);
        if (readout) readout.textContent = `${(value as number).toFixed(param.decimals ?? 2)}${param.unit ?? ''}`;
      }
    }
  }
}
