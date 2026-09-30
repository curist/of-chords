import type { WebAudioSynthSink } from '../audio/synth';
import { DEFAULT_VOICE, parseVoiceParam, VOICE_PARAM_RANGES, WAVEFORMS, type VoiceParams } from '../audio/voice-params';
import { CHORD_BINDINGS } from '../config';
import { describeGamepadStatus, type GamepadInputStatus } from '../input/gamepad';
import { CleanupStack } from '../lifecycle/cleanup-stack';
import { TONIC_OPTIONS } from '../music/notes';
import { MODE_OPTIONS } from '../music/scales';
import type { WebMidiAccess } from '../midi/midi-access';
import type { WebMidiInputManager } from '../midi/midi-input';
import type { WebMidiOutputManager } from '../midi/midi-output';
import type { OutputController } from '../output/output-controller';
import type { InstrumentStore } from '../state/store';
import { requireElement } from './dom';
import { InstrumentView } from './instrument-view';
import { MidiInputView } from './midi-input-view';
import { OutputView } from './output-view';

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
    try {
      this.#renderShell();
      this.#gamepadNotification = new GamepadNotification(
        requireElement<HTMLElement>(this.root, '#gamepad-notification'),
      );
      this.#cleanup.add(() => this.#gamepadNotification.dispose());
      const midiInputView = new MidiInputView(this.root, this.midiInput, this.midiAccess);
      this.#cleanup.add(() => midiInputView.dispose());
      const outputView = new OutputView(this.root, this.output, this.midi, this.midiAccess);
      this.#cleanup.add(() => outputView.dispose());
      const instrumentView = new InstrumentView(this.root, this.store);
      this.#cleanup.add(() => instrumentView.dispose());
      if (SHOW_VOICE_TUNING) this.#bindDevPanel();
    } catch (error) {
      this.#cleanup.dispose();
      throw error;
    }
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
