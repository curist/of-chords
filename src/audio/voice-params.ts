/**
 * Sound-design parameters for the built-in Of Chords voice.
 *
 * These are kept deliberately separate from the synth engine (synth.ts) so we
 * can iterate on the sound — via the development tuning panel — without touching
 * the audio-graph implementation. Once we settle on a voice we like, this is the
 * one object to freeze.
 */
export type Waveform = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface VoiceParams {
  /** Waveform of the fundamental oscillator. */
  readonly oscillator: Waveform;
  /** Waveform of the quieter oscillator playing an octave above. */
  readonly harmonicWaveform: Waveform;
  /** Relative level (0–1) of the harmonic oscillator against the fundamental. */
  readonly harmonicMix: number;
  /** Detune spread in cents between the two oscillators, for gentle warmth. */
  readonly detune: number;
  /** Amplitude-envelope attack, in seconds. */
  readonly attack: number;
  /** Amplitude-envelope decay to the sustain level, in seconds. */
  readonly decay: number;
  /** Sustain level (0–1) held while a note is down. */
  readonly sustain: number;
  /** Amplitude-envelope release, in seconds, after note-off. */
  readonly release: number;
  /** Low-pass filter cutoff, in Hz. */
  readonly filterCutoff: number;
  /** Low-pass filter resonance (Q). */
  readonly filterQ: number;
  /** Wet/dry balance (0 = dry, 1 = fully wet) of the shared reverb. */
  readonly reverbMix: number;
  /** Reverb tail length, in seconds — the size of the generated space. */
  readonly reverbDecay: number;
  /** Reverb high-frequency damping (0 = bright, 1 = dark). */
  readonly reverbDamping: number;
  /** Master output level (0–1) before the safety limiter. */
  readonly masterGain: number;
}

/**
 * The starting voice: bright, punchy polysynth with a warm ambient tail.
 * Square fundamental with a quiet sine octave for shimmer, a gentle low-pass to
 * keep dense chords controlled, a quick attack for chord changes, and a moderate
 * release to connect progressions without muddiness.
 */
export const DEFAULT_VOICE: VoiceParams = {
  oscillator: 'square',
  harmonicWaveform: 'sine',
  harmonicMix: 0.18,
  detune: 6,

  attack: 0.012,
  decay: 0.35,
  sustain: 0.6,
  release: 0.55,

  filterCutoff: 3200,
  filterQ: 0.7,

  // Ambience: an intimate small-to-medium room, present but not a wash.
  reverbMix: 0.22,
  reverbDecay: 1.8,
  reverbDamping: 0.5,

  masterGain: 0.8,
};

export interface VoiceParamRange {
  readonly key: keyof VoiceParams;
  readonly label: string;
  readonly kind: 'range' | 'waveform';
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Number of decimals to show in the panel readout. */
  readonly decimals?: number;
  /** Optional unit suffix for the readout. */
  readonly unit?: string;
}

export const WAVEFORMS: readonly Waveform[] = ['sine', 'triangle', 'sawtooth', 'square'];

/**
 * Sensible ranges for the development tuning panel. Every entry maps to a real
 * parameter in {@link VoiceParams}; we intentionally do not expose raw Web Audio
 * values that would not help sound design.
 */
export const VOICE_PARAM_RANGES: readonly VoiceParamRange[] = [
  { key: 'oscillator', label: 'Oscillator', kind: 'waveform' },
  { key: 'harmonicWaveform', label: 'Harmonic wave', kind: 'waveform' },
  { key: 'harmonicMix', label: 'Harmonic mix', kind: 'range', min: 0, max: 1, step: 0.01, decimals: 2 },
  { key: 'detune', label: 'Detune', kind: 'range', min: 0, max: 30, step: 1, decimals: 0, unit: '¢' },
  { key: 'attack', label: 'Attack', kind: 'range', min: 0.001, max: 0.5, step: 0.001, decimals: 3, unit: 's' },
  { key: 'decay', label: 'Decay', kind: 'range', min: 0.02, max: 1.5, step: 0.01, decimals: 2, unit: 's' },
  { key: 'sustain', label: 'Sustain', kind: 'range', min: 0, max: 1, step: 0.01, decimals: 2 },
  { key: 'release', label: 'Release', kind: 'range', min: 0.05, max: 2, step: 0.01, decimals: 2, unit: 's' },
  { key: 'filterCutoff', label: 'Filter cutoff', kind: 'range', min: 300, max: 8000, step: 50, decimals: 0, unit: 'Hz' },
  { key: 'filterQ', label: 'Filter Q', kind: 'range', min: 0.1, max: 8, step: 0.1, decimals: 1 },
  { key: 'reverbMix', label: 'Reverb mix', kind: 'range', min: 0, max: 1, step: 0.01, decimals: 2 },
  { key: 'reverbDecay', label: 'Reverb decay', kind: 'range', min: 0.2, max: 5, step: 0.1, decimals: 1, unit: 's' },
  { key: 'reverbDamping', label: 'Reverb damping', kind: 'range', min: 0, max: 1, step: 0.01, decimals: 2 },
  { key: 'masterGain', label: 'Master gain', kind: 'range', min: 0, max: 1, step: 0.01, decimals: 2 },
];
