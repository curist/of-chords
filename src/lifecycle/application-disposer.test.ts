import { describe, expect, it } from 'vitest';
import { CleanupStack } from './cleanup-stack';
import { createApplicationDisposer } from './application-disposer';

describe('createApplicationDisposer', () => {
  it('panics first, then cleans every registered resource in reverse order exactly once', () => {
    const order: string[] = [];
    const resources = new CleanupStack();
    for (const name of ['App', 'input', 'manager', 'destination-binding', 'DOM-listener', 'scheduler']) {
      resources.add(() => { order.push(name); });
    }
    const dispose = createApplicationDisposer(resources, () => { order.push('panic'); });

    dispose();
    dispose();

    expect(order).toEqual(['panic', 'scheduler', 'DOM-listener', 'destination-binding', 'manager', 'input', 'App']);
  });

  it('disposes all resources when panic or a resource throws', () => {
    const order: string[] = [];
    const resources = new CleanupStack();
    resources.add(() => { order.push('first'); });
    resources.add(() => { order.push('throwing'); throw new Error('resource failed'); });
    resources.add(() => { order.push('last'); });
    const dispose = createApplicationDisposer(resources, () => {
      order.push('panic');
      throw new Error('panic failed');
    });

    expect(() => dispose()).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(order).toEqual(['panic', 'last', 'throwing', 'first']);
  });
});
