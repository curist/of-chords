import { describe, expect, it, vi } from 'vitest';
import { commitModeSelection, commitProgramSelection, commitTonicSelection, commitVoiceSelection, GamepadNotification, isOutputPanelVisible } from './app';
import type { InstrumentAction } from '../state/instrument';

describe('tonic selection', () => {
  it('dispatches the selected tonic and returns focus to the instrument', () => {
    const blur = vi.fn();
    const select = { value: '7', blur } as unknown as HTMLSelectElement;
    const actions: InstrumentAction[] = [];

    commitTonicSelection(select, (action) => actions.push(action));

    expect(actions).toEqual([{ type: 'set-tonic', tonic: 7 }]);
    expect(blur).toHaveBeenCalledOnce();
  });
});

describe('mode selection', () => {
  it('dispatches the selected mode and returns focus to the instrument', () => {
    const blur = vi.fn();
    const select = { value: 'naturalMinor', blur } as unknown as HTMLSelectElement;
    const actions: InstrumentAction[] = [];

    commitModeSelection(select, (action) => actions.push(action));

    expect(actions).toEqual([{ type: 'set-mode', mode: 'naturalMinor' }]);
    expect(blur).toHaveBeenCalledOnce();
  });
});

describe('program selection', () => {
  it('translates the displayed 1-based program and returns focus to the instrument', () => {
    const blur = vi.fn();
    const input = { value: '41', blur } as unknown as HTMLInputElement;
    const actions: InstrumentAction[] = [];

    commitProgramSelection(input, (action) => actions.push(action));

    expect(actions).toEqual([{ type: 'set-program', program: 40 }]);
    expect(blur).toHaveBeenCalledOnce();
  });
});

describe('output-specific controls', () => {
  it('shows MIDI controls only while MIDI is selected', () => {
    expect(isOutputPanelVisible('midi', 'midi')).toBe(true);
    expect(isOutputPanelVisible('midi', 'builtin')).toBe(false);
  });
});

describe('gamepad status', () => {
  it('shows activation, then dismisses the ready notification after two seconds', () => {
    const label = { textContent: '' };
    const target = {
      dataset: {},
      hidden: true,
      querySelector: () => label,
    } as unknown as HTMLElement;
    let dismiss: (() => void) | null = null;
    const notification = new GamepadNotification(
      target,
      (callback, delay) => { expect(delay).toBe(2000); dismiss = callback; return 1; },
      () => {},
    );

    notification.update('activating');
    expect(target.hidden).toBe(false);
    expect(label.textContent).toBe('Release controller buttons');

    notification.update('ready');
    expect(target.hidden).toBe(false);
    expect(label.textContent).toBe('Controller ready');
    expect(dismiss).not.toBeNull();
    (dismiss as unknown as () => void)();
    expect(target.hidden).toBe(true);
  });

  it('cancels a pending dismissal when the controller disconnects', () => {
    const target = {
      dataset: {},
      hidden: true,
      querySelector: () => ({ textContent: '' }),
    } as unknown as HTMLElement;
    const cleared: number[] = [];
    const notification = new GamepadNotification(target, () => 7, (id) => cleared.push(id));

    notification.update('ready');
    notification.update('hidden');

    expect(cleared).toEqual([7]);
    expect(target.hidden).toBe(true);
  });
});

describe('voice waveform selection', () => {
  it('applies the waveform and returns focus to the instrument', () => {
    const blur = vi.fn();
    const select = { value: 'square', blur } as unknown as HTMLSelectElement;
    const values: string[] = [];

    commitVoiceSelection(select, (value) => values.push(value));

    expect(values).toEqual(['square']);
    expect(blur).toHaveBeenCalledOnce();
  });
});
