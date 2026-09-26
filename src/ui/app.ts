import { CHORD_BINDINGS } from '../config';
import { resolveChord } from '../music/harmony';
import { noteNames, TONIC_OPTIONS } from '../music/notes';
import { MODE_OPTIONS, type Mode } from '../music/scales';
import { voiceChord } from '../music/voicing';
import type { WebMidiOutputManager, MidiOutputSnapshot } from '../midi/midi-output';
import { GENERAL_MIDI_PATCHES } from '../midi/patches';
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

export class App {
  readonly #pointerOwners = new Map<number, string>();

  constructor(
    private readonly root: HTMLElement,
    private readonly store: InstrumentStore,
    private readonly midi: WebMidiOutputManager,
  ) {
    this.#renderShell();
    this.#bindControls();
    this.store.subscribe((state) => this.#renderInstrument(state));
    this.midi.subscribe((snapshot) => this.#renderMidi(snapshot));
  }

  #renderShell(): void {
    this.root.innerHTML = `
      <main class="instrument">
        <header class="hero">
          <p class="eyebrow">WebChords · Browser harmony instrument</p>
          <div class="status-pill" id="midi-status-pill"><span></span><b>Waiting for MIDI</b></div>
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

        <section class="panel midi-panel" aria-labelledby="midi-heading">
          <div><p class="section-label">Output</p><h2 id="midi-heading">Web MIDI</h2><p id="midi-message">Requesting MIDI access…</p></div>
          <label>MIDI Output<select id="midi-output"><option value="">No output selected</option></select></label>
          <button id="panic" class="panic">Panic · All Notes Off</button>
          <div class="patch-controls">
            <label>Patch control<select id="patch-profile"><option value="off">Off · destination controlled</option><option value="gm">General MIDI</option></select></label>
            <button id="previous-patch" aria-label="Previous General MIDI patch"><kbd>[</kbd> ←</button>
            <div class="patch-readout"><strong id="patch-name">Destination controlled</strong><small id="patch-number"></small><small class="patch-caveat">GM names require a GM-compatible destination.</small></div>
            <button id="next-patch" aria-label="Next General MIDI patch">→ <kbd>]</kbd></button>
          </div>
        </section>
      </main>`;
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
    this.root.querySelector<HTMLSelectElement>('#midi-output')?.addEventListener('change', (event) => {
      this.midi.selectOutput((event.target as HTMLSelectElement).value || null);
    });
    this.root.querySelector('#panic')?.addEventListener('click', () => this.store.dispatch({ type: 'panic' }));
    this.root.querySelector<HTMLSelectElement>('#patch-profile')?.addEventListener('change', (event) => {
      const select = event.target as HTMLSelectElement;
      this.store.dispatch({ type: 'set-patch-enabled', enabled: select.value === 'gm' });
      select.blur();
    });
    this.root.querySelector('#previous-patch')?.addEventListener('click', () => this.store.dispatch({ type: 'step-patch', direction: -1 }));
    this.root.querySelector('#next-patch')?.addEventListener('click', () => this.store.dispatch({ type: 'step-patch', direction: 1 }));
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

    const patch = GENERAL_MIDI_PATCHES[state.patch.index];
    const patchProfile = this.root.querySelector<HTMLSelectElement>('#patch-profile')!;
    patchProfile.value = state.patch.enabled ? 'gm' : 'off';
    this.root.querySelector<HTMLElement>('#patch-name')!.textContent = state.patch.enabled ? patch.name : 'Destination controlled';
    this.root.querySelector<HTMLElement>('#patch-number')!.textContent = state.patch.enabled ? `Program ${patch.program + 1} · MIDI ${patch.program}` : '';
    this.root.querySelectorAll<HTMLButtonElement>('#previous-patch, #next-patch').forEach((button) => { button.disabled = !state.patch.enabled; });
  }

  #renderMidi(snapshot: MidiOutputSnapshot): void {
    const select = this.root.querySelector<HTMLSelectElement>('#midi-output')!;
    const emptyOption = new Option('No output selected', '');
    const outputOptions = snapshot.outputs.map((output) => new Option(
      `${output.name}${output.manufacturer ? ` · ${output.manufacturer}` : ''}`,
      output.id,
    ));
    select.replaceChildren(emptyOption, ...outputOptions);
    select.value = snapshot.selectedOutputId ?? '';
    select.disabled = snapshot.status !== 'ready' || snapshot.outputs.length === 0;
    this.root.querySelector<HTMLElement>('#midi-message')!.textContent = snapshot.message;
    const pill = this.root.querySelector<HTMLElement>('#midi-status-pill')!;
    pill.dataset.status = snapshot.status;
    pill.querySelector('b')!.textContent = snapshot.selectedOutputId ? 'MIDI connected' : snapshot.status === 'ready' ? 'MIDI ready' : snapshot.status;
  }
}
