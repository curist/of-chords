import { describe, expect, it } from 'vitest';
import { resolveChord } from './harmony';
import { noteNames } from './notes';
import { voiceChord } from './voicing';

describe('major-key harmony', () => {
  it.each([
    ['C I', { tonic: 0, mode: 'major', degree: 1, shape: 'triad', inversion: 0 }, ['C', 'E', 'G'], [48, 52, 55]],
    ['C ii', { tonic: 0, mode: 'major', degree: 2, shape: 'triad', inversion: 0 }, ['D', 'F', 'A'], [50, 53, 57]],
    ['C V7', { tonic: 0, mode: 'major', degree: 5, shape: 'seventh', inversion: 0 }, ['G', 'B', 'D', 'F'], [55, 59, 62, 65]],
    ['G V', { tonic: 7, mode: 'major', degree: 5, shape: 'triad', inversion: 0 }, ['D', 'F#', 'A'], [50, 54, 57]],
    ['C vii diminished', { tonic: 0, mode: 'major', degree: 7, shape: 'triad', inversion: 0 }, ['B', 'D', 'F'], [59, 62, 65]],
  ] as const)('%s resolves semantic tones and MIDI notes', (_label, intent, names, midi) => {
    const chord = resolveChord(intent);
    expect(noteNames(chord.pitchClasses)).toEqual(names);
    expect(voiceChord(chord, 3)).toEqual(midi);
  });

  it('voices C major in first inversion', () => {
    const chord = resolveChord({ tonic: 0, mode: 'major', degree: 1, shape: 'triad', inversion: 1 });
    expect(voiceChord(chord, 3)).toEqual([52, 55, 60]);
  });

  it.each([
    ['sus2', ['C', 'D', 'G']],
    ['sus4', ['C', 'F', 'G']],
  ] as const)('builds a %s chord from the root', (shape, expected) => {
    const chord = resolveChord({ tonic: 0, mode: 'major', degree: 1, shape, inversion: 0 });
    expect(noteNames(chord.pitchClasses)).toEqual(expected);
  });

  it('transposes the tonic through all pitch classes', () => {
    const roots = Array.from({ length: 12 }, (_, tonic) => resolveChord({
      tonic,
      mode: 'major' as const,
      degree: 1 as const,
      shape: 'triad' as const,
      inversion: 0 as const,
    }).root);
    expect(roots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('natural minor harmony', () => {
  it.each([
    ['A i', { degree: 1, shape: 'triad' }, ['A', 'C', 'E'], 'i'],
    ['A ii diminished', { degree: 2, shape: 'triad' }, ['B', 'D', 'F'], 'ii°'],
    ['A v', { degree: 5, shape: 'triad' }, ['E', 'G', 'B'], 'v'],
    ['A ii half-diminished seventh', { degree: 2, shape: 'seventh' }, ['B', 'D', 'F', 'A'], 'iiø7'],
  ] as const)('%s resolves mode-aware tones and numerals', (_label, partial, names, roman) => {
    const chord = resolveChord({
      tonic: 9,
      mode: 'naturalMinor',
      degree: partial.degree,
      shape: partial.shape,
      inversion: 0,
    });
    expect(noteNames(chord.pitchClasses)).toEqual(names);
    expect(chord.roman).toBe(roman);
  });
});
