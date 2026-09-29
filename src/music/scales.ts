import { normalizePitchClass, type PitchClass } from './notes';

export type Mode =
  | 'major'
  | 'naturalMinor'
  | 'harmonicMinor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian';

export interface ScaleDefinition {
  readonly name: string;
  readonly intervals: readonly number[];
  readonly romanTriads: readonly string[];
}

export const SCALES: Record<Mode, ScaleDefinition> = {
  major: {
    name: 'Major',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    romanTriads: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  },
  naturalMinor: {
    name: 'Natural minor',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    romanTriads: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
  },
  harmonicMinor: {
    name: 'Harmonic minor',
    intervals: [0, 2, 3, 5, 7, 8, 11],
    romanTriads: ['i', 'ii°', 'III+', 'iv', 'V', 'VI', 'vii°'],
  },
  dorian: {
    name: 'Dorian',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    romanTriads: ['i', 'ii', 'III', 'IV', 'v', 'vi°', 'VII'],
  },
  phrygian: {
    name: 'Phrygian',
    intervals: [0, 1, 3, 5, 7, 8, 10],
    romanTriads: ['i', 'II', 'III', 'iv', 'v°', 'VI', 'vii'],
  },
  lydian: {
    name: 'Lydian',
    intervals: [0, 2, 4, 6, 7, 9, 11],
    romanTriads: ['I', 'II', 'iii', 'iv°', 'V', 'vi', 'vii'],
  },
  mixolydian: {
    name: 'Mixolydian',
    intervals: [0, 2, 4, 5, 7, 9, 10],
    romanTriads: ['I', 'ii', 'iii°', 'IV', 'v', 'vi', 'VII'],
  },
  locrian: {
    name: 'Locrian',
    intervals: [0, 1, 3, 5, 6, 8, 10],
    romanTriads: ['i°', 'II', 'iii', 'iv', 'V', 'VI', 'vii'],
  },
};

export const MODE_OPTIONS = (Object.entries(SCALES) as Array<[Mode, ScaleDefinition]>).map(([value, scale]) => ({
  value,
  name: scale.name,
}));

export function scaleTone(tonic: PitchClass, mode: Mode, zeroBasedDegree: number): number {
  const scale = SCALES[mode];
  const octave = Math.floor(zeroBasedDegree / scale.intervals.length);
  const index = ((zeroBasedDegree % scale.intervals.length) + scale.intervals.length) % scale.intervals.length;
  return normalizePitchClass(tonic) + scale.intervals[index] + octave * 12;
}
