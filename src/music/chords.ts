export type ScaleDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type ChordShape = 'triad' | 'seventh' | 'sus2' | 'sus4';
export type Inversion = 0 | 1 | 2;
export type ChordQuality = 'major' | 'minor' | 'diminished' | 'suspended';

const ROMAN_TRIADS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'] as const;

export function romanNumeral(degree: ScaleDegree, shape: ChordShape): string {
  const base = ROMAN_TRIADS[degree - 1];
  if (shape === 'seventh') {
    if (degree === 1 || degree === 4) return `${base}maj7`;
    if (degree === 7) return `${base}7`;
    return `${base}7`;
  }
  if (shape === 'sus2') return `${base}sus2`;
  if (shape === 'sus4') return `${base}sus4`;
  return base;
}
