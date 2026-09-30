export type PitchClass = number;

export function parsePitchClass(value: string): PitchClass | null {
  if (value.trim() === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 11 ? number : null;
}

const SHARP_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function normalizePitchClass(value: number): PitchClass {
  return ((value % 12) + 12) % 12;
}

export function noteName(pitchClass: PitchClass): string {
  return SHARP_NOTE_NAMES[normalizePitchClass(pitchClass)];
}

export function noteNames(pitchClasses: readonly PitchClass[]): string[] {
  return pitchClasses.map(noteName);
}

export function midiNoteName(note: number): string {
  const octave = Math.floor(note / 12) - 1;
  return `${noteName(note)}${octave}`;
}

export const TONIC_OPTIONS = SHARP_NOTE_NAMES.map((name, value) => ({ name, value }));
