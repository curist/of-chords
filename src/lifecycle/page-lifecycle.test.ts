import { describe, expect, it, vi } from 'vitest';
import { handlePageHide } from './page-lifecycle';

describe('page lifecycle', () => {
  it('keeps MIDI subscriptions alive when the page enters the back-forward cache', () => {
    const midiInput = { dispose: vi.fn() };
    const midiOutput = { dispose: vi.fn() };
    const panic = vi.fn();

    handlePageHide({ persisted: true }, midiInput, midiOutput, panic);

    expect(panic).toHaveBeenCalledOnce();
    expect(midiInput.dispose).not.toHaveBeenCalled();
    expect(midiOutput.dispose).not.toHaveBeenCalled();
  });

  it('disposes MIDI subscriptions when the page is actually unloaded', () => {
    const midiInput = { dispose: vi.fn() };
    const midiOutput = { dispose: vi.fn() };
    const panic = vi.fn();

    handlePageHide({ persisted: false }, midiInput, midiOutput, panic);

    expect(panic).toHaveBeenCalledOnce();
    expect(midiInput.dispose).toHaveBeenCalledOnce();
    expect(midiOutput.dispose).toHaveBeenCalledOnce();
  });
});
