import { describe, expect, it } from 'vitest';
import { WebAudioSynthSink } from './synth';

// A minimal fake of the slice of Web Audio the synth uses, recording enough to
// assert the note lifecycle without exercising real DSP.

class FakeParam {
  value = 0;
  setValueAtTime(value: number): this { this.value = value; return this; }
  linearRampToValueAtTime(value: number): this { this.value = value; return this; }
  setTargetAtTime(value: number): this { this.value = value; return this; }
  cancelScheduledValues(): this { return this; }
}

class FakeNode {
  disconnected = 0;
  connect<T>(target: T): T { return target; }
  disconnect(): void { this.disconnected += 1; }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode { type = 'lowpass'; frequency = new FakeParam(); Q = new FakeParam(); }
class FakeConvolver extends FakeNode { normalize = false; buffer: unknown = null; }
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam();
  attack = new FakeParam(); release = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  detune = new FakeParam();
  started = 0;
  stopped = 0;
  onended: (() => void) | null = null;
  start(): void { this.started += 1; }
  stop(): void { this.stopped += 1; }
  end(): void { this.onended?.(); }
}

class FakeBuffer {
  readonly channels: Float32Array[];
  constructor(count: number, length: number) {
    this.channels = Array.from({ length: count }, () => new Float32Array(length));
  }
  getChannelData(index: number): Float32Array { return this.channels[index]; }
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state: 'suspended' | 'running' = 'running';
  destination = new FakeNode();
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly convolvers: FakeConvolver[] = [];
  buffers: FakeBuffer[] = [];
  createGain(): FakeGain { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createBiquadFilter(): FakeFilter { return new FakeFilter(); }
  createDynamicsCompressor(): FakeCompressor { return new FakeCompressor(); }
  createConvolver(): FakeConvolver { const c = new FakeConvolver(); this.convolvers.push(c); return c; }
  createOscillator(): FakeOscillator { const o = new FakeOscillator(); this.oscillators.push(o); return o; }
  createBuffer(count: number, length: number): FakeBuffer {
    const b = new FakeBuffer(count, length);
    this.buffers.push(b);
    return b;
  }
  async resume(): Promise<void> { this.state = 'running'; }
}

function makeSynth() {
  const ctx = new FakeAudioContext();
  const synth = new WebAudioSynthSink(undefined, () => ctx as unknown as AudioContext);
  return { ctx, synth };
}

describe('WebAudioSynthSink', () => {
  it('uses the triangle default voice at the requested output level', () => {
    const { ctx, synth } = makeSynth();
    synth.noteOn(60);

    expect(ctx.oscillators[0].type).toBe('triangle');
    expect(ctx.gains[0].gain.value).toBe(0.8);
  });

  it('starts two oscillators per note and tracks the voice', () => {
    const { ctx, synth } = makeSynth();
    synth.noteOn(60);
    synth.noteOn(64);
    synth.noteOn(67);
    expect(ctx.oscillators).toHaveLength(6);
    expect(ctx.oscillators.every((osc) => osc.started === 1)).toBe(true);
  });

  it('releases oscillators on noteOff and tears them down when the tail ends', () => {
    const { ctx, synth } = makeSynth();
    synth.noteOn(60);
    const [osc1, osc2] = ctx.oscillators;
    synth.noteOff(60);
    expect(osc1.stopped).toBe(1);
    expect(osc2.stopped).toBe(1);

    osc1.end(); // simulate the release tail completing
    expect(osc1.disconnected).toBeGreaterThan(0);
    expect(osc2.disconnected).toBeGreaterThan(0);

    // A later noteOn for the same note is a fresh voice, not the retired one.
    synth.noteOn(60);
    expect(ctx.oscillators).toHaveLength(4);
  });

  it('ignores noteOff for notes that are not sounding', () => {
    const { ctx, synth } = makeSynth();
    expect(() => synth.noteOff(60)).not.toThrow();
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('retires a stale voice if the same note is retriggered', () => {
    const { ctx, synth } = makeSynth();
    synth.noteOn(60);
    synth.noteOn(60);
    const [firstOsc] = ctx.oscillators;
    expect(firstOsc.stopped).toBe(1);
    expect(ctx.oscillators).toHaveLength(4);
  });

  it('releases every voice on allNotesOff', () => {
    const { ctx, synth } = makeSynth();
    synth.noteOn(60);
    synth.noteOn(64);
    synth.allNotesOff();
    expect(ctx.oscillators.every((osc) => osc.stopped === 1)).toBe(true);
    // The engine no longer tracks them: a subsequent noteOn makes new voices.
    synth.noteOn(67);
    expect(ctx.oscillators).toHaveLength(6);
  });

  it('builds one shared convolver reverb and rebuilds only the IR on decay change', () => {
    const { ctx, synth } = makeSynth();
    synth.noteOn(60);
    expect(ctx.convolvers).toHaveLength(1);
    const buffersAfterStart = ctx.buffers.length;
    expect(buffersAfterStart).toBeGreaterThan(0);

    synth.setParams({ reverbDecay: 3 });
    expect(ctx.convolvers).toHaveLength(1); // reused, not recreated
    expect(ctx.buffers.length).toBe(buffersAfterStart + 1); // fresh IR buffer
  });
});
