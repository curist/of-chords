import type { ChordShape, Inversion, ScaleDegree } from '../music/chords';
import { resolveChord } from '../music/harmony';
import { midiNoteName, type PitchClass } from '../music/notes';
import type { Mode } from '../music/scales';
import { voiceChord } from '../music/voicing';

export interface ActiveChord {
  readonly kind: 'chord';
  readonly owner: string;
  readonly degree: ScaleDegree;
  readonly velocity: number;
  readonly name: string;
  readonly roman: string;
  readonly notes: readonly number[];
  readonly noteNames: readonly string[];
  readonly shape: ChordShape;
  readonly inversion: Inversion;
}

export interface ActiveLiteralNote {
  readonly kind: 'literal';
  readonly owner: string;
  readonly degree?: never;
  readonly note: number;
  readonly velocity: number;
  readonly name: string;
  readonly roman: 'Passthrough';
  readonly notes: readonly number[];
  readonly noteNames: readonly string[];
}

export type ActiveGesture = ActiveChord | ActiveLiteralNote;

export interface InstrumentState {
  readonly tonic: PitchClass;
  readonly mode: Mode;
  readonly shape: ChordShape;
  readonly inversion: Inversion;
  readonly register: number;
  readonly active: Readonly<Record<string, ActiveGesture>>;
  readonly history: readonly ActiveChord[];
  readonly program: number | null;
}

export type InstrumentAction =
  | { readonly type: 'press'; readonly owner: string; readonly degree: ScaleDegree; readonly velocity?: number }
  | { readonly type: 'press-note'; readonly owner: string; readonly note: number; readonly velocity: number }
  | { readonly type: 'release'; readonly owner: string }
  | { readonly type: 'set-tonic'; readonly tonic: PitchClass }
  | { readonly type: 'set-mode'; readonly mode: Mode }
  | { readonly type: 'set-shape'; readonly shape: ChordShape }
  | { readonly type: 'set-inversion'; readonly inversion: Inversion }
  | { readonly type: 'set-program'; readonly program: number }
  | { readonly type: 'step-program'; readonly direction: -1 | 1 }
  | { readonly type: 'resend-program' }
  | { readonly type: 'panic' };

export type InstrumentEffect =
  | { readonly type: 'acquire'; readonly owner: string; readonly notes: readonly number[]; readonly velocity: number }
  | { readonly type: 'release'; readonly owner: string }
  | { readonly type: 'program-change'; readonly program: number }
  | { readonly type: 'panic' };

export interface InstrumentTransition {
  readonly state: InstrumentState;
  readonly effects: readonly InstrumentEffect[];
}

export function createInitialState(): InstrumentState {
  return {
    tonic: 0,
    mode: 'major',
    shape: 'triad',
    inversion: 0,
    register: 3,
    active: {},
    history: [],
    program: null,
  };
}

function clampMidiInteger(value: number, minimum: number): number {
  return Math.min(127, Math.max(minimum, Math.trunc(value)));
}

export function reduceInstrument(state: InstrumentState, action: InstrumentAction): InstrumentTransition {
  switch (action.type) {
    case 'press': {
      if (state.active[action.owner]) return { state, effects: [] };
      const velocity = action.velocity === undefined ? 100 : clampMidiInteger(action.velocity, 1);
      const chord = resolveChord({
        tonic: state.tonic,
        mode: state.mode,
        degree: action.degree,
        shape: state.shape,
        inversion: state.inversion,
      });
      const notes = voiceChord(chord, state.register);
      const activeChord: ActiveChord = {
        kind: 'chord',
        owner: action.owner,
        degree: action.degree,
        velocity,
        name: chord.name,
        roman: chord.roman,
        notes,
        noteNames: notes.map(midiNoteName),
        shape: state.shape,
        inversion: state.inversion,
      };
      return {
        state: {
          ...state,
          active: { ...state.active, [action.owner]: activeChord },
          history: [...state.history, activeChord].slice(-8),
        },
        effects: [{ type: 'acquire', owner: action.owner, notes, velocity }],
      };
    }
    case 'press-note': {
      if (state.active[action.owner]) return { state, effects: [] };
      const note = clampMidiInteger(action.note, 0);
      const velocity = clampMidiInteger(action.velocity, 1);
      const notes = [note];
      const name = midiNoteName(note);
      const activeLiteral: ActiveLiteralNote = {
        kind: 'literal',
        owner: action.owner,
        note,
        velocity,
        name,
        roman: 'Passthrough',
        notes,
        noteNames: [name],
      };
      return {
        state: { ...state, active: { ...state.active, [action.owner]: activeLiteral } },
        effects: [{ type: 'acquire', owner: action.owner, notes, velocity }],
      };
    }
    case 'release': {
      if (!state.active[action.owner]) return { state, effects: [] };
      const active = { ...state.active };
      delete active[action.owner];
      return { state: { ...state, active }, effects: [{ type: 'release', owner: action.owner }] };
    }
    case 'set-tonic':
      return action.tonic === state.tonic ? { state, effects: [] } : { state: { ...state, tonic: action.tonic }, effects: [] };
    case 'set-mode':
      return action.mode === state.mode ? { state, effects: [] } : { state: { ...state, mode: action.mode }, effects: [] };
    case 'set-shape':
      return action.shape === state.shape ? { state, effects: [] } : { state: { ...state, shape: action.shape }, effects: [] };
    case 'set-inversion':
      return action.inversion === state.inversion ? { state, effects: [] } : { state: { ...state, inversion: action.inversion }, effects: [] };
    case 'step-program': {
      const program = ((state.program ?? (action.direction < 0 ? 0 : -1)) + action.direction + 128) % 128;
      return {
        state: { ...state, active: {}, program },
        effects: [{ type: 'panic' }, { type: 'program-change', program }],
      };
    }
    case 'set-program': {
      const program = Math.min(127, Math.max(0, Math.trunc(action.program)));
      if (program === state.program) return { state, effects: [] };
      return {
        state: { ...state, active: {}, program },
        effects: [{ type: 'panic' }, { type: 'program-change', program }],
      };
    }
    case 'resend-program':
      return state.program !== null
        ? { state, effects: [{ type: 'program-change', program: state.program }] }
        : { state, effects: [] };
    case 'panic':
      return { state: { ...state, active: {} }, effects: [{ type: 'panic' }] };
  }
}
