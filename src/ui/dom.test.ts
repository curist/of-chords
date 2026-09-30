// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseVoiceParam, VOICE_PARAM_RANGES, WAVEFORMS } from '../audio/voice-params';
import { parseOutputMode, requireElement } from './dom';

describe('output mode parser', () => {
  it.each(['builtin', 'midi'] as const)('accepts %s', (value) => {
    expect(parseOutputMode(value)).toBe(value);
  });

  it.each(['', ' ', 'MIDI', '__proto__', 'other'])('rejects %j', (value) => {
    expect(parseOutputMode(value)).toBeNull();
  });
});

describe('required DOM lookup', () => {
  it('returns the matching element', () => {
    const root = document.createElement('div');
    const input = document.createElement('input');
    input.id = 'program';
    root.append(input);

    expect(requireElement<HTMLInputElement>(root, '#program')).toBe(input);
  });

  it('identifies a missing selector in its error', () => {
    expect(() => requireElement<HTMLInputElement>(document, '#missing-program')).toThrow('#missing-program');
  });
});

describe('voice parameter parser', () => {
  it.each(VOICE_PARAM_RANGES.filter((range) => range.kind === 'waveform').flatMap(({ key }) =>
    WAVEFORMS.map((value) => [key, value] as const)))('accepts waveform %s=%s', (key, value) => {
    expect(parseVoiceParam(key, value)).toEqual({ [key]: value });
  });

  it.each(VOICE_PARAM_RANGES.filter((range) => range.kind === 'range').flatMap(({ key, min, max }) => [
    [key, String(min), min], [key, String(max), max],
  ] as const))('accepts numeric boundary %s=%s', (key, value, expected) => {
    expect(parseVoiceParam(key, value)).toEqual({ [key]: expected });
  });

  it.each([
    ['unknown', '1'], ['__proto__', '1'], ['oscillator', '1'], ['harmonicMix', 'sine'],
    ['harmonicMix', ''], ['harmonicMix', ' '], ['harmonicMix', 'NaN'], ['harmonicMix', 'Infinity'],
    ['harmonicMix', '-0.01'], ['harmonicMix', '1.01'], ['filterCutoff', '299'], ['filterCutoff', '8001'],
    ['oscillator', 'sinewave'], ['oscillator', '__proto__'],
  ])('rejects invalid %s=%s', (key, value) => {
    expect(parseVoiceParam(key, value)).toBeNull();
  });
});
