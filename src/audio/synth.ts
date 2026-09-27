import type { NoteSink } from '../midi/note-ledger';
import { DEFAULT_VOICE, type VoiceParams } from './voice-params';

/**
 * A small polyphonic Web Audio voice — the built-in Of Chords sound.
 *
 * Per note the graph is:
 *
 *   fundamental osc ─┐
 *                    ├─▶ low-pass filter ─▶ envelope gain ─▶ synth bus
 *   harmonic osc  ───┘
 *
 * All voices share one output bus, and the bus splits into a dry path and a
 * single shared convolution reverb (a common acoustic space for every chord
 * tone) before the master gain and a safety limiter:
 *
 *   synth bus ─┬─▶ dry gain ───────────────────────┐
 *              └─▶ convolver ─▶ wet gain ───────────┴─▶ master ─▶ limiter ─▶ out
 *
 * One AudioContext, one master gain, one limiter (a compressor acting as a
 * brick-wall), one convolver shared by every voice so dense chords stay
 * controlled. Each note owns its own oscillators and envelope, released
 * independently and torn down once its release tail finishes so nodes never leak.
 */

const A4_MIDI = 69;
const A4_HZ = 440;
/** Peak amplitude of a single full-velocity voice feeding the master gain. */
const BASE_VOICE_GAIN = 0.28;

function midiToFrequency(note: number): number {
  return A4_HZ * 2 ** ((note - A4_MIDI) / 12);
}

interface Voice {
  readonly osc1: OscillatorNode;
  readonly osc2: OscillatorNode;
  readonly env: GainNode;
  /** Marks the voice as retired so a late release/onended cannot double-free. */
  released: boolean;
}

/** The subset of the Web Audio API we depend on, so tests can inject a fake. */
export type AudioContextFactory = () => AudioContext;

export class WebAudioSynthSink implements NoteSink {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #bus: GainNode | null = null;
  #dry: GainNode | null = null;
  #wet: GainNode | null = null;
  #convolver: ConvolverNode | null = null;
  readonly #voices = new Map<number, Voice>();
  #params: VoiceParams;

  constructor(
    params: VoiceParams = DEFAULT_VOICE,
    private readonly createContext: AudioContextFactory = () => new AudioContext(),
  ) {
    this.#params = params;
  }

  /** Current voice parameters (a copy so callers cannot mutate internals). */
  get params(): VoiceParams {
    return { ...this.#params };
  }

  /**
   * Update the voice. Master gain and the reverb mix/decay apply immediately;
   * the oscillator/envelope/filter parameters affect newly played notes.
   */
  setParams(partial: Partial<VoiceParams>): void {
    const previous = this.#params;
    this.#params = { ...previous, ...partial };
    if (!this.#ctx) return;
    const now = this.#ctx.currentTime;
    if (this.#master) this.#master.gain.setTargetAtTime(this.#params.masterGain, now, 0.02);
    if (partial.reverbMix !== undefined) this.#applyReverbMix(now);
    if (partial.reverbDecay !== undefined || partial.reverbDamping !== undefined) {
      this.#rebuildImpulseResponse();
    }
  }

  /**
   * Create/resume the audio graph. Must be triggered from a user gesture the
   * first time so browser autoplay policy allows sound.
   */
  async resume(): Promise<void> {
    const ctx = this.#ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Some browsers reject resume() outside a gesture; the next gesture retries.
      }
    }
  }

  noteOn(note: number, velocity = 100): void {
    const ctx = this.#ensureContext();
    if (ctx.state === 'suspended') void ctx.resume();

    // Defensive: the ledger de-dupes note-ons, but if one slips through, retire
    // the stale voice before starting a fresh one so we never leak oscillators.
    const existing = this.#voices.get(note);
    if (existing) this.#stopVoice(note, existing, 0.01);

    const now = ctx.currentTime;
    const { oscillator, harmonicWaveform, harmonicMix, detune, attack, decay, sustain } = this.#params;
    const frequency = midiToFrequency(note);
    const peak = BASE_VOICE_GAIN * Math.max(0, Math.min(1, velocity / 127));
    const mix = Math.max(0, Math.min(1, harmonicMix));

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(this.#params.filterCutoff, now);
    filter.Q.setValueAtTime(this.#params.filterQ, now);

    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(1 / (1 + mix), now);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(mix / (1 + mix), now);

    const osc1 = ctx.createOscillator();
    osc1.type = oscillator;
    osc1.frequency.setValueAtTime(frequency, now);
    osc1.detune.setValueAtTime(-detune / 2, now);

    const osc2 = ctx.createOscillator();
    osc2.type = harmonicWaveform;
    osc2.frequency.setValueAtTime(frequency * 2, now);
    osc2.detune.setValueAtTime(detune / 2, now);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peak, now + attack);
    env.gain.linearRampToValueAtTime(Math.max(0.0001, peak * sustain), now + attack + decay);

    osc1.connect(gain1).connect(filter);
    osc2.connect(gain2).connect(filter);
    filter.connect(env).connect(this.#bus!);

    osc1.start(now);
    osc2.start(now);

    const voice: Voice = { osc1, osc2, env, released: false };
    osc1.onended = () => this.#teardownVoice(note, voice, [osc1, osc2, gain1, gain2, filter, env]);
    this.#voices.set(note, voice);
  }

  noteOff(note: number): void {
    const voice = this.#voices.get(note);
    if (!voice) return;
    this.#stopVoice(note, voice, this.#params.release);
  }

  allNotesOff(): void {
    for (const [note, voice] of this.#voices) {
      this.#stopVoice(note, voice, this.#params.release);
    }
  }

  #stopVoice(note: number, voice: Voice, release: number): void {
    if (voice.released) return;
    voice.released = true;
    // This note may retrigger before the tail finishes; free the slot now.
    if (this.#voices.get(note) === voice) this.#voices.delete(note);
    const ctx = this.#ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const tail = Math.max(0.01, release);
    voice.env.gain.cancelScheduledValues(now);
    voice.env.gain.setValueAtTime(Math.max(0.0001, voice.env.gain.value), now);
    voice.env.gain.linearRampToValueAtTime(0.0001, now + tail);
    try {
      voice.osc1.stop(now + tail);
      voice.osc2.stop(now + tail);
    } catch {
      // Already stopped; onended will still fire the teardown.
    }
  }

  #teardownVoice(note: number, voice: Voice, nodes: AudioNode[]): void {
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // Node may already be disconnected.
      }
    }
    if (this.#voices.get(note) === voice) this.#voices.delete(note);
  }

  #ensureContext(): AudioContext {
    if (this.#ctx) return this.#ctx;
    const ctx = this.createContext();
    const now = ctx.currentTime;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-6, now);
    limiter.knee.setValueAtTime(0, now);
    limiter.ratio.setValueAtTime(20, now);
    limiter.attack.setValueAtTime(0.003, now);
    limiter.release.setValueAtTime(0.25, now);

    const master = ctx.createGain();
    master.gain.setValueAtTime(this.#params.masterGain, now);
    master.connect(limiter).connect(ctx.destination);

    // Shared output bus splitting into dry and one common reverb.
    const bus = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.normalize = true;
    bus.connect(dry).connect(master);
    bus.connect(convolver).connect(wet).connect(master);

    this.#ctx = ctx;
    this.#master = master;
    this.#bus = bus;
    this.#dry = dry;
    this.#wet = wet;
    this.#convolver = convolver;

    this.#rebuildImpulseResponse();
    this.#applyReverbMix(now);
    return ctx;
  }

  /** Balance dry/wet. Dry stays at unity; wet is the subtle reverb on top. */
  #applyReverbMix(when: number): void {
    const mix = Math.max(0, Math.min(1, this.#params.reverbMix));
    this.#dry?.gain.setTargetAtTime(1, when, 0.02);
    this.#wet?.gain.setTargetAtTime(mix, when, 0.02);
  }

  /**
   * Generate a programmatic stereo impulse response — decaying noise, no audio
   * assets. Assigning a fresh buffer replaces the old one, which is then GC'd;
   * the convolver node itself is reused so nothing leaks.
   */
  #rebuildImpulseResponse(): void {
    const ctx = this.#ctx;
    const convolver = this.#convolver;
    if (!ctx || !convolver) return;
    const decay = Math.max(0.05, this.#params.reverbDecay);
    const damping = Math.max(0, Math.min(1, this.#params.reverbDamping));
    const length = Math.max(1, Math.floor(ctx.sampleRate * decay));
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    // One-pole low-pass coefficient: darker (more damped) tail as damping rises.
    const dampCoeff = damping * damping * 0.92;
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = impulse.getChannelData(channel);
      let filtered = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        filtered = white * (1 - dampCoeff) + filtered * dampCoeff;
        // Curved (roughly exponential) amplitude decay to a smooth silent tail.
        const envelope = (1 - i / length) ** 2.5;
        samples[i] = filtered * envelope;
      }
    }
    convolver.buffer = impulse;
  }
}
