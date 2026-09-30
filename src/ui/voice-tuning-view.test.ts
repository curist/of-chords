// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { WebAudioSynthSink } from '../audio/synth';
import { VoiceTuningView } from './voice-tuning-view';

function createFixture() {
  const root = document.createElement('div');
  root.innerHTML = '<main></main>';
  document.body.replaceChildren(root);
  const synth = new WebAudioSynthSink();
  const view = new VoiceTuningView(root, synth);
  return { root, synth, view };
}

describe('VoiceTuningView', () => {
  it('shows the current voice with the expected readout precision and units', () => {
    const { root } = createFixture();
    expect(root.querySelector<HTMLSelectElement>('[data-voice-param="oscillator"]')?.value).toBe('triangle');
    expect(root.querySelector('[data-voice-readout="detune"]')?.textContent).toBe('6¢');
    expect(root.querySelector('[data-voice-readout="attack"]')?.textContent).toBe('0.012s');
    expect(root.querySelector('[data-voice-readout="filterCutoff"]')?.textContent).toBe('3200Hz');
  });

  it('commits valid controls and refreshes their readouts', () => {
    const { root, synth } = createFixture();
    const mix = root.querySelector<HTMLInputElement>('[data-voice-param="harmonicMix"]')!;
    mix.value = '0.4';
    mix.dispatchEvent(new Event('input', { bubbles: true }));
    const oscillator = root.querySelector<HTMLSelectElement>('[data-voice-param="oscillator"]')!;
    oscillator.value = 'square';
    oscillator.dispatchEvent(new Event('input', { bubbles: true }));

    expect(synth.params.harmonicMix).toBe(0.4);
    expect(synth.params.oscillator).toBe('square');
    expect(root.querySelector('[data-voice-readout="harmonicMix"]')?.textContent).toBe('0.40');
  });

  it('rejects invalid values and keys without calling the synth', () => {
    const { root, synth } = createFixture();
    const setParams = vi.spyOn(synth, 'setParams');
    const mix = root.querySelector<HTMLInputElement>('[data-voice-param="harmonicMix"]')!;
    mix.max = '2';
    mix.value = '1.5';
    mix.dispatchEvent(new Event('input', { bubbles: true }));
    const oscillator = root.querySelector<HTMLSelectElement>('[data-voice-param="oscillator"]')!;
    oscillator.dataset.voiceParam = '__proto__';
    oscillator.dispatchEvent(new Event('input', { bubbles: true }));

    expect(setParams).not.toHaveBeenCalled();
    expect(synth.params.harmonicMix).toBe(0.18);
  });

  it('resets the synth and readouts to defaults', () => {
    const { root, synth } = createFixture();
    synth.setParams({ detune: 12 });
    root.querySelector<HTMLButtonElement>('#voice-reset')!.click();

    expect(synth.params.detune).toBe(6);
    expect(root.querySelector('[data-voice-readout="detune"]')?.textContent).toBe('6¢');
  });

  it('shows controls only for built-in output', () => {
    const { root, view } = createFixture();
    const panel = root.querySelector<HTMLElement>('.voice-panel')!;
    expect(panel.hidden).toBe(false);
    view.setOutputMode('midi');
    expect(panel.hidden).toBe(true);
    view.setOutputMode('builtin');
    expect(panel.hidden).toBe(false);
  });

  it('removes input and reset behavior on disposal', () => {
    const { root, synth, view } = createFixture();
    view.dispose();
    view.dispose();
    const mix = root.querySelector<HTMLInputElement>('[data-voice-param="harmonicMix"]')!;
    mix.value = '0.4';
    mix.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('#voice-reset')!.click();

    expect(synth.params.harmonicMix).toBe(0.18);
  });
});
