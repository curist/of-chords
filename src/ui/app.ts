import type { WebAudioSynthSink } from '../audio/synth';
import { DEFAULT_VOICE, VOICE_PARAM_RANGES, WAVEFORMS, type VoiceParams } from '../audio/voice-params';
import { CHORD_BINDINGS } from '../config';
import { describeGamepadStatus, type GamepadInputStatus } from '../input/gamepad';
import { resolveChord } from '../music/harmony';
import { noteNames, TONIC_OPTIONS } from '../music/notes';
import { MODE_OPTIONS, type Mode } from '../music/scales';
import { voiceChord } from '../music/voicing';
import type { WebMidiOutputManager, MidiOutputSnapshot } from '../midi/midi-output';
import type { OutputController, OutputMode, OutputSnapshot } from '../output/output-controller';
import type { InstrumentAction, InstrumentState } from '../state/instrument';
import type { InstrumentStore } from '../state/store';

export function commitTonicSelection(
  select: HTMLSelectElement,
  dispatch: (action: InstrumentAction) => void,
): void {
  dispatch({ type: 'set-tonic', tonic: Number(select.value) });
  select.blur();
}

export function commitModeSelection(
  select: HTMLSelectElement,
  dispatch: (action: InstrumentAction) => void,
): void {
  dispatch({ type: 'set-mode', mode: select.value as Mode });
  select.blur();
}

export function commitProgramSelection(
  input: HTMLInputElement,
  dispatch: (action: InstrumentAction) => void,
): void {
  if (input.value.trim()) dispatch({ type: 'set-program', program: Number(input.value) - 1 });
  input.blur();
}

export function commitVoiceSelection(
  select: HTMLSelectElement,
  apply: (value: string) => void,
): void {
  apply(select.value);
  select.blur();
}

export function isOutputPanelVisible(panel: OutputMode, mode: OutputMode): boolean {
  return panel === mode;
}

// The voice-tuning panel is for iterating on the built-in voice, so it only
// appears in dev (`npm run dev`), never in a production build.
const SHOW_VOICE_TUNING = import.meta.env.DEV;

export class App {
  readonly #pointerOwners = new Map<number, string>();
  #latestMidi: MidiOutputSnapshot | null = null;
  #mode: OutputMode = 'builtin';

  constructor(
    private readonly root: HTMLElement,
    private readonly store: InstrumentStore,
    private readonly midi: WebMidiOutputManager,
    private readonly output: OutputController,
    private readonly synth: WebAudioSynthSink,
  ) {
    this.#renderShell();
    this.#bindControls();
    this.store.subscribe((state) => this.#renderInstrument(state));
    this.midi.subscribe((snapshot) => this.#renderMidi(snapshot));
    this.output.subscribe((snapshot) => this.#renderOutput(snapshot));
  }

  setGamepadStatus(status: GamepadInputStatus): void {
    const pill = this.root.querySelector<HTMLElement>('#gamepad-status-pill');
    if (!pill) return;
    pill.dataset.status = status;
    pill.querySelector('b')!.textContent = describeGamepadStatus(status);
  }

  #renderShell(): void {
    this.root.innerHTML = `
      <main class="instrument">
        <header class="hero">
          <p class="eyebrow">Of Chords</p>
          <div class="header-statuses">
            <div class="status-pill" id="gamepad-status-pill" data-status="waiting"><span></span><b>Press A to connect controller</b></div>
            <div class="status-pill" id="output-status-pill"><span></span><b>Built-in voice</b></div>
          </div>
        </header>

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

        <section aria-labelledby="chords-heading">
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
            <div id="currently-sounding" class="empty-state">Press a chord key</div>
          </article>
          <article class="panel history">
            <p class="section-label">Recent progression</p>
            <div id="history-names" class="progression empty-state">No chords yet</div>
            <div id="history-romans" class="progression roman-line"></div>
          </article>
        </section>

        <section class="panel output-panel" aria-labelledby="output-heading">
          <div class="output-head">
            <div><p class="section-label">Output</p><h2 id="output-heading">Sound output</h2><p id="output-message"></p></div>
            <div class="segmented" id="output-mode" aria-label="Sound output">
              <button data-output="builtin">Built-in</button><button data-output="midi">MIDI</button>
            </div>
            <button id="panic" class="panic" data-output-panel="midi">Panic · All Notes Off</button>
          </div>

          <div class="output-midi" data-output-panel="midi">
            <label>MIDI Output<select id="midi-output"><option value="">No output selected</option></select></label>
            <div class="program-controls">
              <button id="previous-program" aria-label="Previous MIDI program"><span>←</span><kbd>[</kbd></button>
              <label>Program<input id="program-input" type="number" min="1" max="128" placeholder="—"></label>
              <button id="next-program" aria-label="Next MIDI program"><span>→</span><kbd>]</kbd></button>
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
    this.root.querySelector<HTMLSelectElement>('#tonic-select')?.addEventListener('change', (event) => {
      commitTonicSelection(event.target as HTMLSelectElement, (action) => this.store.dispatch(action));
    });
    this.root.querySelector<HTMLSelectElement>('#mode-select')?.addEventListener('change', (event) => {
      commitModeSelection(event.target as HTMLSelectElement, (action) => this.store.dispatch(action));
    });
    this.root.querySelector('#shape-controls')?.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-shape]');
      if (button) this.store.dispatch({ type: 'set-shape', shape: button.dataset.shape as 'triad' | 'seventh' | 'sus2' | 'sus4' });
    });
    this.root.querySelector('#inversion-controls')?.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-inversion]');
      if (button) this.store.dispatch({ type: 'set-inversion', inversion: Number(button.dataset.inversion) as 0 | 1 | 2 });
    });
    this.root.querySelector('#chord-grid')?.addEventListener('pointerdown', (event) => {
      const pointer = event as PointerEvent;
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-degree]');
      if (!button) return;
      event.preventDefault();
      button.setPointerCapture(pointer.pointerId);
      const owner = `pointer:${pointer.pointerId}`;
      this.#pointerOwners.set(pointer.pointerId, owner);
      this.store.dispatch({ type: 'press', owner, degree: Number(button.dataset.degree) as 1 | 2 | 3 | 4 | 5 | 6 | 7 });
    });
    const releasePointer = (event: Event) => {
      const pointer = event as PointerEvent;
      const owner = this.#pointerOwners.get(pointer.pointerId);
      if (!owner) return;
      this.#pointerOwners.delete(pointer.pointerId);
      this.store.dispatch({ type: 'release', owner });
    };
    this.root.querySelector('#chord-grid')?.addEventListener('pointerup', releasePointer);
    this.root.querySelector('#chord-grid')?.addEventListener('pointercancel', releasePointer);
    this.root.querySelector('#output-mode')?.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-output]');
      if (button) this.output.setMode(button.dataset.output as OutputMode);
    });
    this.root.querySelector<HTMLSelectElement>('#midi-output')?.addEventListener('change', (event) => {
      this.midi.selectOutput((event.target as HTMLSelectElement).value || null);
    });
    this.root.querySelector('#panic')?.addEventListener('click', () => this.store.dispatch({ type: 'panic' }));
    if (SHOW_VOICE_TUNING) this.#bindDevPanel();
    this.root.querySelector('#previous-program')?.addEventListener('click', () => this.store.dispatch({ type: 'step-program', direction: -1 }));
    this.root.querySelector('#next-program')?.addEventListener('click', () => this.store.dispatch({ type: 'step-program', direction: 1 }));
    this.root.querySelector<HTMLInputElement>('#program-input')?.addEventListener('change', (event) => {
      commitProgramSelection(event.target as HTMLInputElement, (action) => this.store.dispatch(action));
    });
  }

  #renderInstrument(state: InstrumentState): void {
    const tonic = this.root.querySelector<HTMLSelectElement>('#tonic-select');
    if (tonic) tonic.value = String(state.tonic);
    const mode = this.root.querySelector<HTMLSelectElement>('#mode-select');
    if (mode) mode.value = state.mode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach((button) => button.classList.toggle('selected', button.dataset.shape === state.shape));
    this.root.querySelectorAll<HTMLButtonElement>('[data-inversion]').forEach((button) => button.classList.toggle('selected', Number(button.dataset.inversion) === state.inversion));

    const activeDegrees = new Set(Object.values(state.active).map((chord) => chord.degree));
    this.root.querySelectorAll<HTMLButtonElement>('.chord-pad').forEach((button) => {
      const degree = Number(button.dataset.degree) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
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
    current.innerHTML = active.length === 0 ? 'Press a chord key' : active.map((chord) => `
      <div class="sounding-chord"><div><strong>${chord.name}</strong><span>${chord.roman}</span></div><p>${chord.noteNames.join(' &nbsp; ')}<small>MIDI ${chord.notes.join(' · ')}</small></p></div>`).join('');

    const historyNames = this.root.querySelector<HTMLElement>('#history-names')!;
    historyNames.classList.toggle('empty-state', state.history.length === 0);
    historyNames.textContent = state.history.length ? state.history.map((chord) => chord.name).join(' → ') : 'No chords yet';
    this.root.querySelector<HTMLElement>('#history-romans')!.textContent = state.history.map((chord) => chord.roman).join(' → ');

    const programInput = this.root.querySelector<HTMLInputElement>('#program-input')!;
    programInput.value = state.program === null ? '' : String(state.program + 1);
  }

  #renderMidi(snapshot: MidiOutputSnapshot): void {
    this.#latestMidi = snapshot;
    const select = this.root.querySelector<HTMLSelectElement>('#midi-output')!;
    const emptyOption = new Option('No output selected', '');
    const outputOptions = snapshot.outputs.map((output) => new Option(
      `${output.name}${output.manufacturer ? ` · ${output.manufacturer}` : ''}`,
      output.id,
    ));
    select.replaceChildren(emptyOption, ...outputOptions);
    select.value = snapshot.selectedOutputId ?? '';
    select.disabled = snapshot.status !== 'ready' || snapshot.outputs.length === 0;
    this.#renderStatus();
  }

  #renderOutput(snapshot: OutputSnapshot): void {
    this.#mode = snapshot.mode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-output]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.output === snapshot.mode);
    });
    this.root.querySelectorAll<HTMLElement>('[data-output-panel]').forEach((panel) => {
      panel.hidden = !isOutputPanelVisible(panel.dataset.outputPanel as OutputMode, snapshot.mode);
    });
    if (SHOW_VOICE_TUNING) {
      const voicePanel = this.root.querySelector<HTMLElement>('.voice-panel');
      if (voicePanel) voicePanel.hidden = snapshot.mode !== 'builtin';
    }
    this.#renderStatus();
  }

  #renderStatus(): void {
    const pill = this.root.querySelector<HTMLElement>('#output-status-pill')!;
    const message = this.root.querySelector<HTMLElement>('#output-message')!;
    if (this.#mode === 'builtin') {
      pill.dataset.status = 'ready';
      pill.querySelector('b')!.textContent = 'Built-in voice';
      message.textContent = 'Playing the built-in voice.';
      return;
    }
    const midi = this.#latestMidi;
    pill.dataset.status = midi?.status ?? 'idle';
    pill.querySelector('b')!.textContent = midi?.selectedOutputId
      ? 'MIDI connected'
      : midi?.status === 'ready' ? 'MIDI ready' : midi?.status ?? 'MIDI';
    message.textContent = midi?.message ?? 'Requesting MIDI access…';
  }

  #bindDevPanel(): void {
    this.root.querySelector('.voice-panel')?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      const key = target.dataset.voiceParam as keyof VoiceParams | undefined;
      if (!key) return;
      if (target instanceof HTMLSelectElement) {
        commitVoiceSelection(target, (value) => this.synth.setParams({ [key]: value } as Partial<VoiceParams>));
      } else {
        this.synth.setParams({ [key]: Number(target.value) } as Partial<VoiceParams>);
      }
      this.#renderVoiceParams(this.synth.params);
    });
    this.root.querySelector('#voice-reset')?.addEventListener('click', () => {
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
