import { normalizePitchClass, type PitchClass } from './notes';

export type Mode = 'major';

export interface ScaleDefinition {
  readonly name: string;
  readonly intervals: readonly number[];
}

export const SCALES: Record<Mode, ScaleDefinition> = {
  major: {
    name: 'Major',
    intervals: [0, 2, 4, 5, 7, 9, 11],
  },
};

export function scaleTone(tonic: PitchClass, mode: Mode, zeroBasedDegree: number): number {
  const scale = SCALES[mode];
  const octave = Math.floor(zeroBasedDegree / scale.intervals.length);
  const index = ((zeroBasedDegree % scale.intervals.length) + scale.intervals.length) % scale.intervals.length;
  return normalizePitchClass(tonic) + scale.intervals[index] + octave * 12;
}
