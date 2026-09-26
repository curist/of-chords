import { describe, expect, it, vi } from 'vitest';
import { commitModeSelection, commitTonicSelection } from './app';
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
