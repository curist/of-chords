import { CleanupStack } from '../lifecycle/cleanup-stack';
import { parseChordShape, parseInversion, parseScaleDegree, type ScaleDegree } from '../music/chords';
import { resolveChord } from '../music/harmony';
import { noteNames, parsePitchClass } from '../music/notes';
import { parseMode } from '../music/scales';
import { voiceChord } from '../music/voicing';
import type { ActiveGesture, InstrumentState } from '../state/instrument';
import type { InstrumentStore } from '../state/store';
import { requireElement } from './dom';

interface CachedPad {
  button: HTMLButtonElement;
  degree: ScaleDegree | null;
  roman: HTMLElement;
  name: HTMLElement;
  notes: HTMLElement;
}

export class InstrumentView {
  readonly #cleanup = new CleanupStack();
  readonly #pointerOwners = new Map<number, { owner: string; button: HTMLButtonElement }>();
  readonly #tonic: HTMLSelectElement;
  readonly #mode: HTMLSelectElement;
  readonly #shapeControls: HTMLElement;
  readonly #shapeButtons: readonly HTMLButtonElement[];
  readonly #inversionControls: HTMLElement;
  readonly #inversionButtons: readonly HTMLButtonElement[];
  readonly #chordGrid: HTMLElement;
  readonly #pads: readonly CachedPad[];
  readonly #current: HTMLElement;
  readonly #historyNames: HTMLElement;
  readonly #historyRomans: HTMLElement;
  readonly #panic: HTMLButtonElement;
  readonly #previousProgram: HTMLButtonElement;
  readonly #nextProgram: HTMLButtonElement;
  readonly #programInput: HTMLInputElement;

  constructor(root: HTMLElement, private readonly store: InstrumentStore) {
    this.#tonic = requireElement(root, '#tonic-select');
    this.#mode = requireElement(root, '#mode-select');
    this.#shapeControls = requireElement(root, '#shape-controls');
    this.#shapeButtons = [...this.#shapeControls.querySelectorAll<HTMLButtonElement>('[data-shape]')];
    this.#inversionControls = requireElement(root, '#inversion-controls');
    this.#inversionButtons = [...this.#inversionControls.querySelectorAll<HTMLButtonElement>('[data-inversion]')];
    this.#chordGrid = requireElement(root, '#chord-grid');
    this.#pads = [...this.#chordGrid.querySelectorAll<HTMLButtonElement>('.chord-pad')].map((button) => ({
      button,
      degree: parseScaleDegree(button.dataset.degree ?? ''),
      roman: requireElement(button, '.roman'),
      name: requireElement(button, 'strong'),
      notes: requireElement(button, 'small'),
    }));
    this.#current = requireElement(root, '#currently-sounding');
    this.#historyNames = requireElement(root, '#history-names');
    this.#historyRomans = requireElement(root, '#history-romans');
    this.#panic = requireElement(root, '#panic');
    this.#previousProgram = requireElement(root, '#previous-program');
    this.#nextProgram = requireElement(root, '#next-program');
    this.#programInput = requireElement(root, '#program-input');
    try {
      this.#listen(root, 'change', (event) => {
        if (event.target instanceof HTMLSelectElement) event.target.blur();
      });
      this.#listen(this.#tonic, 'change', () => {
        const tonic = parsePitchClass(this.#tonic.value);
        if (tonic !== null) this.store.dispatch({ type: 'set-tonic', tonic });
      });
      this.#listen(this.#mode, 'change', () => {
        const mode = parseMode(this.#mode.value);
        if (mode !== null) this.store.dispatch({ type: 'set-mode', mode });
      });
      this.#listen(this.#shapeControls, 'click', (event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-shape]') : null;
        const shape = parseChordShape(button?.dataset.shape ?? '');
        if (shape !== null) this.store.dispatch({ type: 'set-shape', shape });
      });
      this.#listen(this.#inversionControls, 'click', (event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-inversion]') : null;
        const inversion = parseInversion(button?.dataset.inversion ?? '');
        if (inversion !== null) this.store.dispatch({ type: 'set-inversion', inversion });
      });
      this.#listen(this.#chordGrid, 'pointerdown', (event) => {
        const pointer = event as PointerEvent;
        const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-degree]') : null;
        const degree = parseScaleDegree(button?.dataset.degree ?? '');
        if (!button || degree === null || !this.#pads.some((pad) => pad.button === button && pad.degree === degree)) return;
        event.preventDefault();
        button.setPointerCapture(pointer.pointerId);
        const owner = `pointer:${pointer.pointerId}`;
        this.#pointerOwners.set(pointer.pointerId, { owner, button });
        this.store.dispatch({ type: 'press', owner, degree });
      });
      const releasePointer = (event: Event) => {
        const pointer = event as PointerEvent;
        const pointerOwner = this.#pointerOwners.get(pointer.pointerId);
        if (!pointerOwner) return;
        this.#pointerOwners.delete(pointer.pointerId);
        this.store.dispatch({ type: 'release', owner: pointerOwner.owner });
      };
      this.#listen(this.#chordGrid, 'pointerup', releasePointer);
      this.#listen(this.#chordGrid, 'pointercancel', releasePointer);
      this.#listen(this.#chordGrid, 'lostpointercapture', releasePointer);
      this.#listen(this.#panic, 'click', () => this.store.dispatch({ type: 'panic' }));
      this.#listen(this.#previousProgram, 'click', () => this.store.dispatch({ type: 'step-program', direction: -1 }));
      this.#listen(this.#nextProgram, 'click', () => this.store.dispatch({ type: 'step-program', direction: 1 }));
      this.#listen(this.#programInput, 'change', () => {
        const value = this.#programInput.value;
        const program = Number(value);
        if (value.trim() !== '' && Number.isInteger(program) && program >= 1 && program <= 128) {
          this.store.dispatch({ type: 'set-program', program: program - 1 });
        }
        this.#programInput.blur();
      });
      this.#cleanup.add(this.store.subscribe((state) => {
        if (!this.#cleanup.disposed) this.#render(state);
      }));
    } catch (error) {
      this.#cleanup.dispose();
      throw error;
    }
  }

  dispose(): void {
    this.#cleanup.dispose();
    for (const [pointerId, { button }] of this.#pointerOwners) {
      if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    }
    this.#pointerOwners.clear();
  }

  #listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.#cleanup.add(() => target.removeEventListener(type, listener));
  }

  #render(state: InstrumentState): void {
    this.#tonic.value = String(state.tonic);
    this.#mode.value = state.mode;
    for (const button of this.#shapeButtons) {
      button.classList.toggle('selected', button.dataset.shape === state.shape);
    }
    for (const button of this.#inversionButtons) {
      button.classList.toggle('selected', parseInversion(button.dataset.inversion ?? '') === state.inversion);
    }

    const activeDegrees = new Set(Object.values(state.active)
      .filter((gesture) => gesture.kind === 'chord')
      .map((chord) => chord.degree));
    for (const pad of this.#pads) {
      if (pad.degree === null || parseScaleDegree(pad.button.dataset.degree ?? '') !== pad.degree) continue;
      const chord = resolveChord({ tonic: state.tonic, mode: state.mode, degree: pad.degree, shape: state.shape, inversion: state.inversion });
      const notes = voiceChord(chord, state.register);
      pad.roman.textContent = chord.roman;
      pad.name.textContent = chord.name;
      pad.notes.textContent = noteNames(chord.pitchClasses).join(' · ');
      pad.button.classList.toggle('active', activeDegrees.has(pad.degree));
      pad.button.setAttribute('aria-pressed', String(activeDegrees.has(pad.degree)));
      pad.button.title = `MIDI ${notes.join(', ')}`;
    }

    const active = Object.values(state.active);
    this.#current.classList.toggle('empty-state', active.length === 0);
    this.#current.innerHTML = active.length === 0 ? 'Play a chord' : active.map((gesture) => this.#renderGesture(gesture)).join('');
    this.#historyNames.classList.toggle('empty-state', state.history.length === 0);
    this.#historyNames.textContent = state.history.length ? state.history.map((chord) => chord.name).join(' → ') : 'No chords yet';
    this.#historyRomans.textContent = state.history.map((chord) => chord.roman).join(' → ');
    this.#programInput.value = state.program === null ? '' : String(state.program + 1);
  }

  #renderGesture(gesture: ActiveGesture): string {
    if (gesture.kind === 'literal') {
      return `<div class="sounding-chord"><div><strong>${gesture.name}</strong><span>Passthrough</span></div><p><small>MIDI ${gesture.note}</small></p></div>`;
    }
    return `<div class="sounding-chord"><div><strong>${gesture.name}</strong><span>${gesture.roman}</span></div><p>${gesture.noteNames.join(' &nbsp; ')}<small>MIDI ${gesture.notes.join(' · ')}</small></p></div>`;
  }
}
