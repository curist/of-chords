import { describe, expect, it, vi } from 'vitest';
import { commitModeSelection, commitPatchSelection, commitTonicSelection, isOutputPanelVisible } from './app';
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

describe('patch selection', () => {
  it('dispatches the selected program index and returns focus to the instrument', () => {
    const blur = vi.fn();
    const select = { value: '40', blur } as unknown as HTMLSelectElement;
    const actions: InstrumentAction[] = [];

    commitPatchSelection(select, (action) => actions.push(action));

    expect(actions).toEqual([{ type: 'select-patch', index: 40 }]);
    expect(blur).toHaveBeenCalledOnce();
  });
});

describe('output-specific controls', () => {
  it('shows MIDI controls only while MIDI is selected', () => {
    expect(isOutputPanelVisible('midi', 'midi')).toBe(true);
    expect(isOutputPanelVisible('midi', 'builtin')).toBe(false);
  });
});
