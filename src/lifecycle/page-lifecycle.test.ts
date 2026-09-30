import { describe, expect, it, vi } from 'vitest';
import { handlePageHide } from './page-lifecycle';

describe('page lifecycle', () => {
  it('keeps MIDI subscriptions alive when the page enters the back-forward cache', () => {
    const dispose = vi.fn();
    const panic = vi.fn();

    handlePageHide({ persisted: true }, dispose, panic);

    expect(panic).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('uses the application disposer when the page is actually unloaded', () => {
    const dispose = vi.fn();
    const panic = vi.fn();

    handlePageHide({ persisted: false }, dispose, panic);

    expect(dispose).toHaveBeenCalledOnce();
    expect(panic).not.toHaveBeenCalled();
  });
});
