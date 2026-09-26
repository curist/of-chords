import type { AbstractChord } from './harmony';

export function voiceChord(chord: AbstractChord, register: number): number[] {
  const rootMidi = (register + 1) * 12 + chord.root;
  const notes = chord.intervals.map((interval) => rootMidi + interval);
  for (let index = 0; index < chord.inversion; index += 1) {
    const lowest = notes.shift();
    if (lowest !== undefined) notes.push(lowest + 12);
  }
  return notes;
}
