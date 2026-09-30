import { describe, expect, it } from 'vitest';
import { parseChordShape, parseInversion, parseScaleDegree, type ScaleDegree } from './chords';
import { resolveChord } from './harmony';
import { noteNames, parsePitchClass } from './notes';
import { parseMode, scaleDegreeForPitchClass, type Mode } from './scales';
import { voiceChord } from './voicing';

describe('DOM harmony value parsers', () => {
  it.each(Array.from({ length: 12 }, (_, value) => [String(value), value] as const))('accepts pitch class %s', (value, expected) => {
    expect(parsePitchClass(value)).toBe(expected);
  });

  it.each(Array.from({ length: 7 }, (_, index) => [String(index + 1), index + 1] as const))('accepts scale degree %s', (value, expected) => {
    expect(parseScaleDegree(value)).toBe(expected);
  });

  it.each(['triad', 'seventh', 'sus2', 'sus4'] as const)('accepts chord shape %s', (value) => {
    expect(parseChordShape(value)).toBe(value);
  });

  it.each([0, 1, 2] as const)('accepts inversion %i', (value) => {
    expect(parseInversion(String(value))).toBe(value);
  });

  it.each(['major', 'naturalMinor', 'harmonicMinor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian'] as const)('accepts mode %s', (value) => {
    expect(parseMode(value)).toBe(value);
  });

  it.each([
    [parsePitchClass, ['', ' ', '0.5', 'NaN', 'Infinity', '-1', '12', '__proto__']],
    [parseScaleDegree, ['', ' ', '1.5', 'NaN', 'Infinity', '0', '8', '__proto__']],
    [parseInversion, ['', ' ', '0.5', 'NaN', 'Infinity', '-1', '3', '__proto__']],
  ] as const)('rejects malformed integer values', (parse, values) => {
    for (const value of values) expect(parse(value)).toBeNull();
  });

  it.each(['', ' ', 'major ', 'unknown', '__proto__'])('rejects invalid mode %j', (value) => {
    expect(parseMode(value)).toBeNull();
  });

  it.each(['', ' ', 'Triad', 'unknown', '__proto__'])('rejects invalid shape %j', (value) => {
    expect(parseChordShape(value)).toBeNull();
  });
});

describe('scale degree lookup', () => {
  it.each([
    ['C', 0, 1], ['D', 2, 2], ['E', 4, 3], ['F', 5, 4],
    ['G', 7, 5], ['A', 9, 6], ['B', 11, 7],
  ] as const)('maps %s in C major to its scale degree', (_name, pitchClass, degree) => {
    expect(scaleDegreeForPitchClass(0, 'major', pitchClass)).toBe(degree);
  });

  it.each([
    ['D', 2, 1], ['E', 4, 2], ['F#', 6, 3], ['G', 7, 4],
    ['A', 9, 5], ['B', 11, 6], ['C#', 1, 7],
  ] as const)('maps %s in D major to its scale degree', (_name, pitchClass, degree) => {
    expect(scaleDegreeForPitchClass(2, 'major', pitchClass)).toBe(degree);
  });

  it.each([[14, 1], [-10, 1], [26, 1]] as const)('normalizes octave-shifted pitch class %s', (pitchClass, degree) => {
    expect(scaleDegreeForPitchClass(2, 'major', pitchClass)).toBe(degree);
  });

  it('returns null for F# outside C natural minor', () => {
    expect(scaleDegreeForPitchClass(0, 'naturalMinor', 6)).toBeNull();
  });
});

describe('major-key harmony', () => {
  it.each([
    ['C I', { tonic: 0, mode: 'major', degree: 1, shape: 'triad', inversion: 0 }, ['C', 'E', 'G'], [48, 52, 55]],
    ['C ii', { tonic: 0, mode: 'major', degree: 2, shape: 'triad', inversion: 0 }, ['D', 'F', 'A'], [50, 53, 57]],
    ['C V7', { tonic: 0, mode: 'major', degree: 5, shape: 'seventh', inversion: 0 }, ['G', 'B', 'D', 'F'], [55, 59, 62, 65]],
    ['G V', { tonic: 7, mode: 'major', degree: 5, shape: 'triad', inversion: 0 }, ['D', 'F#', 'A'], [62, 66, 69]],
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

  it('keeps transposed scale-degree roots ascending through the register', () => {
    const roots = Array.from({ length: 7 }, (_, index) => {
      const chord = resolveChord({
        tonic: 7,
        mode: 'major',
        degree: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        shape: 'triad',
        inversion: 0,
      });
      return voiceChord(chord, 3)[0];
    });
    expect(roots).toEqual([55, 57, 59, 60, 62, 64, 66]);
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

describe('Dorian harmony', () => {
  it.each([
    ['D i', { degree: 1, shape: 'triad' }, ['D', 'F', 'A'], 'i'],
    ['D IV', { degree: 4, shape: 'triad' }, ['G', 'B', 'D'], 'IV'],
    ['D vi diminished', { degree: 6, shape: 'triad' }, ['B', 'D', 'F'], 'vi°'],
    ['D IV7', { degree: 4, shape: 'seventh' }, ['G', 'B', 'D', 'F'], 'IV7'],
  ] as const)('%s resolves mode-aware tones and numerals', (_label, partial, names, roman) => {
    const chord = resolveChord({
      tonic: 2,
      mode: 'dorian',
      degree: partial.degree,
      shape: partial.shape,
      inversion: 0,
    });
    expect(noteNames(chord.pitchClasses)).toEqual(names);
    expect(chord.roman).toBe(roman);
  });
});

describe('Mixolydian harmony', () => {
  it.each([
    ['G I', { degree: 1, shape: 'triad' }, ['G', 'B', 'D'], 'I'],
    ['G iii diminished', { degree: 3, shape: 'triad' }, ['B', 'D', 'F'], 'iii°'],
    ['G v', { degree: 5, shape: 'triad' }, ['D', 'F', 'A'], 'v'],
    ['G VII', { degree: 7, shape: 'triad' }, ['F', 'A', 'C'], 'VII'],
    ['G I7', { degree: 1, shape: 'seventh' }, ['G', 'B', 'D', 'F'], 'I7'],
  ] as const)('%s resolves mode-aware tones and numerals', (_label, partial, names, roman) => {
    const chord = resolveChord({
      tonic: 7,
      mode: 'mixolydian',
      degree: partial.degree,
      shape: partial.shape,
      inversion: 0,
    });
    expect(noteNames(chord.pitchClasses)).toEqual(names);
    expect(chord.roman).toBe(roman);
  });
});

describe('harmonic minor harmony', () => {
  it.each([
    ['A i', { degree: 1, shape: 'triad' }, ['A', 'C', 'E'], 'i', 'Am', 'minor'],
    ['A minor-major seventh', { degree: 1, shape: 'seventh' }, ['A', 'C', 'E', 'G#'], 'imaj7', 'Ammaj7', 'minor'],
    ['A III augmented', { degree: 3, shape: 'triad' }, ['C', 'E', 'G#'], 'III+', 'Caug', 'augmented'],
    ['A V', { degree: 5, shape: 'triad' }, ['E', 'G#', 'B'], 'V', 'E', 'major'],
    ['A vii diminished seventh', { degree: 7, shape: 'seventh' }, ['G#', 'B', 'D', 'F'], 'vii°7', 'G#dim7', 'diminished'],
  ] as const)('%s resolves mode-aware harmony', (_label, partial, names, roman, name, quality) => {
    const chord = resolveChord({
      tonic: 9,
      mode: 'harmonicMinor',
      degree: partial.degree,
      shape: partial.shape,
      inversion: 0,
    });
    expect(noteNames(chord.pitchClasses)).toEqual(names);
    expect(chord.roman).toBe(roman);
    expect(chord.name).toBe(name);
    expect(chord.quality).toBe(quality);
  });
});

type ModalTriadCase = readonly [label: string, degree: ScaleDegree, names: readonly string[], roman: string];
type ModalHarmonyCases = readonly [label: string, mode: Mode, tonic: number, cases: readonly ModalTriadCase[]];

const MODAL_HARMONY_CASES: readonly ModalHarmonyCases[] = [
  ['Phrygian', 'phrygian', 4, [
    ['E i', 1, ['E', 'G', 'B'], 'i'],
    ['E II', 2, ['F', 'A', 'C'], 'II'],
    ['E v diminished', 5, ['B', 'D', 'F'], 'v°'],
  ]],
  ['Lydian', 'lydian', 0, [
    ['C I', 1, ['C', 'E', 'G'], 'I'],
    ['C II', 2, ['D', 'F#', 'A'], 'II'],
    ['C iv diminished', 4, ['F#', 'A', 'C'], 'iv°'],
  ]],
  ['Locrian', 'locrian', 11, [
    ['B i diminished', 1, ['B', 'D', 'F'], 'i°'],
    ['B II', 2, ['C', 'E', 'G'], 'II'],
    ['B V', 5, ['F', 'A', 'C'], 'V'],
  ]],
] as const;

describe.each(MODAL_HARMONY_CASES)('%s harmony', (_label, mode, tonic, cases) => {
  it.each(cases)('%s resolves mode-aware tones and numerals', (_caseLabel, degree, names, roman) => {
    const chord = resolveChord({ tonic, mode, degree, shape: 'triad', inversion: 0 });
    expect(noteNames(chord.pitchClasses)).toEqual(names);
    expect(chord.roman).toBe(roman);
  });
});
