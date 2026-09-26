import type { ChordShape, Inversion, ScaleDegree } from '../music/chords';
import { resolveChord } from '../music/harmony';
import { midiNoteName, type PitchClass } from '../music/notes';
import type { Mode } from '../music/scales';
import { voiceChord } from '../music/voicing';

export interface ActiveChord {
  readonly owner: string;
  readonly degree: ScaleDegree;
  readonly name: string;
  readonly roman: string;
  readonly notes: readonly number[];
  readonly noteNames: readonly string[];
  readonly shape: ChordShape;
  readonly inversion: Inversion;
}

export interface InstrumentState {
  readonly tonic: PitchClass;
  readonly mode: Mode;
  readonly shape: ChordShape;
  readonly inversion: Inversion;
  readonly register: number;
  readonly active: Readonly<Record<string, ActiveChord>>;
  readonly history: readonly ActiveChord[];
}

export type InstrumentAction =
  | { readonly type: 'press'; readonly owner: string; readonly degree: ScaleDegree }
  | { readonly type: 'release'; readonly owner: string }
  | { readonly type: 'set-tonic'; readonly tonic: PitchClass }
  | { readonly type: 'set-mode'; readonly mode: Mode }
  | { readonly type: 'set-shape'; readonly shape: ChordShape }
  | { readonly type: 'set-inversion'; readonly inversion: Inversion }
  | { readonly type: 'panic' };

export type InstrumentEffect =
  | { readonly type: 'acquire'; readonly owner: string; readonly notes: readonly number[] }
  | { readonly type: 'release'; readonly owner: string }
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
  };
}

export function reduceInstrument(state: InstrumentState, action: InstrumentAction): InstrumentTransition {
  switch (action.type) {
    case 'press': {
      if (state.active[action.owner]) return { state, effects: [] };
      const chord = resolveChord({
        tonic: state.tonic,
        mode: state.mode,
        degree: action.degree,
        shape: state.shape,
        inversion: state.inversion,
      });
      const notes = voiceChord(chord, state.register);
      const activeChord: ActiveChord = {
        owner: action.owner,
        degree: action.degree,
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
        effects: [{ type: 'acquire', owner: action.owner, notes }],
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
    case 'panic':
      return { state: { ...state, active: {} }, effects: [{ type: 'panic' }] };
  }
}
