import type { ScaleDegree } from './music/chords';

export interface ChordBinding {
  readonly code: string;
  readonly key: string;
  readonly degree: ScaleDegree;
}

export const CHORD_BINDINGS: readonly ChordBinding[] = [
  { code: 'KeyA', key: 'A', degree: 1 },
  { code: 'KeyS', key: 'S', degree: 2 },
  { code: 'KeyD', key: 'D', degree: 3 },
  { code: 'KeyF', key: 'F', degree: 4 },
  { code: 'KeyG', key: 'G', degree: 5 },
  { code: 'KeyH', key: 'H', degree: 6 },
  { code: 'KeyJ', key: 'J', degree: 7 },
];
