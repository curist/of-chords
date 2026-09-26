import { normalizePitchClass, type PitchClass } from './notes';

export type Mode = 'major' | 'naturalMinor' | 'dorian';

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
  dorian: {
    name: 'Dorian',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    romanTriads: ['i', 'ii', 'III', 'IV', 'v', 'vi°', 'VII'],
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
