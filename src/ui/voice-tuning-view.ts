import type { WebAudioSynthSink } from '../audio/synth';
import { DEFAULT_VOICE, parseVoiceParam, VOICE_PARAM_RANGES, WAVEFORMS, type VoiceParamRange, type VoiceParams } from '../audio/voice-params';
import { CleanupStack } from '../lifecycle/cleanup-stack';
import type { OutputMode } from '../output/output-controller';
import { requireElement } from './dom';

interface CachedVoiceControl {
  range: VoiceParamRange;
  control: HTMLInputElement | HTMLSelectElement;
  readout: HTMLOutputElement | null;
}

export class VoiceTuningView {
  readonly #cleanup = new CleanupStack();
  readonly #panel: HTMLElement;
  readonly #reset: HTMLButtonElement;
  readonly #controls: readonly CachedVoiceControl[];

  constructor(root: HTMLElement, private readonly synth: WebAudioSynthSink) {
    const controls = VOICE_PARAM_RANGES.map((param) => {
      if (param.kind === 'waveform') {
        return `<label class="voice-field">${param.label}
          <select data-voice-param="${param.key}">${WAVEFORMS.map((wave) => `<option value="${wave}">${wave}</option>`).join('')}</select>
        </label>`;
      }
      return `<label class="voice-field">${param.label} <output data-voice-readout="${param.key}"></output>
        <input type="range" data-voice-param="${param.key}" min="${param.min}" max="${param.max}" step="${param.step}">
      </label>`;
    }).join('');
    requireElement(root, 'main').insertAdjacentHTML('beforeend', `
      <section class="panel voice-panel" aria-labelledby="voice-heading">
        <div class="voice-panel-head">
          <div><p class="section-label">Development</p><h2 id="voice-heading">Voice tuning</h2><p>Shapes newly played notes. Dev build only.</p></div>
          <button id="voice-reset" class="voice-reset">Reset defaults</button>
        </div>
        <div class="voice-grid">${controls}</div>
      </section>`);
    this.#panel = requireElement(root, '.voice-panel');
    this.#reset = requireElement(this.#panel, '#voice-reset');
    this.#controls = VOICE_PARAM_RANGES.map((range) => ({
      range,
      control: requireElement<HTMLInputElement | HTMLSelectElement>(this.#panel, `[data-voice-param="${range.key}"]`),
      readout: range.kind === 'range'
        ? requireElement<HTMLOutputElement>(this.#panel, `[data-voice-readout="${range.key}"]`)
        : null,
    }));
    try {
      this.#listen(this.#panel, 'input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
        const params = parseVoiceParam(target.dataset.voiceParam ?? '', target.value);
        if (params === null) return;
        this.synth.setParams(params);
        this.#render(this.synth.params);
      });
      this.#listen(this.#reset, 'click', () => {
        this.synth.setParams(DEFAULT_VOICE);
        this.#render(this.synth.params);
      });
      this.#render(this.synth.params);
    } catch (error) {
      this.#cleanup.dispose();
      throw error;
    }
  }

  setOutputMode(mode: OutputMode): void {
    if (!this.#cleanup.disposed) this.#panel.hidden = mode !== 'builtin';
  }

  dispose(): void {
    this.#cleanup.dispose();
  }

  #listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.#cleanup.add(() => target.removeEventListener(type, listener));
  }

  #render(params: VoiceParams): void {
    for (const { range, control, readout } of this.#controls) {
      const value = params[range.key];
      control.value = String(value);
      if (readout && typeof value === 'number') {
        readout.textContent = `${value.toFixed(range.decimals ?? 2)}${range.unit ?? ''}`;
      }
    }
  }
}
