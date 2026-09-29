export type ScaleDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type ChordShape = 'triad' | 'seventh' | 'sus2' | 'sus4';
export type Inversion = 0 | 1 | 2;
export type ChordQuality = 'major' | 'minor' | 'diminished' | 'augmented' | 'suspended';

export function romanNumeral(base: string, shape: ChordShape, intervals: readonly number[]): string {
  if (shape === 'seventh') {
    if (base.endsWith('°') && intervals[3] === 10) return `${base.slice(0, -1)}ø7`;
    if (intervals[3] === 11) return `${base}maj7`;
    return `${base}7`;
  }
  if (shape === 'sus2') return `${base}sus2`;
  if (shape === 'sus4') return `${base}sus4`;
  return base;
}
