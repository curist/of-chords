import { describe, expect, it } from 'vitest';
import { CleanupStack } from './cleanup-stack';

describe('CleanupStack', () => {
  it('runs cleanups in reverse registration order only once', () => {
    const order: string[] = [];
    const resources = new CleanupStack();
    expect(resources.disposed).toBe(false);
    const first = () => { order.push('first'); };
    expect(resources.add(first)).toBe(first);
    resources.add(() => { order.push('second'); });

    resources.dispose();
    resources.dispose();

    expect(resources.disposed).toBe(true);
    expect(order).toEqual(['second', 'first']);
  });

  it('continues after a callback throws', () => {
    const order: string[] = [];
    const resources = new CleanupStack();
    resources.add(() => { order.push('first'); });
    resources.add(() => { throw new Error('failed cleanup'); });
    resources.add(() => { order.push('last'); });

    expect(() => resources.dispose()).not.toThrow();
    expect(order).toEqual(['last', 'first']);
  });

  it('immediately invokes a cleanup added after disposal only once', () => {
    const calls: string[] = [];
    const resources = new CleanupStack();
    resources.dispose();
    const cleanup = () => { calls.push('late'); };

    expect(resources.add(cleanup)).toBe(cleanup);
    resources.dispose();

    expect(calls).toEqual(['late']);
  });

  it('does not invoke the same cleanup twice when it is registered repeatedly', () => {
    const calls: string[] = [];
    const resources = new CleanupStack();
    const cleanup = () => { calls.push('shared'); };
    resources.add(cleanup);
    resources.add(cleanup);

    resources.dispose();
    resources.add(cleanup);

    expect(calls).toEqual(['shared']);
  });

  it('stays disposed when a cleanup registers another cleanup', () => {
    const order: string[] = [];
    const resources = new CleanupStack();
    resources.add(() => {
      expect(resources.disposed).toBe(true);
      resources.add(() => { order.push('nested'); });
      order.push('outer');
    });

    resources.dispose();

    expect(order).toEqual(['nested', 'outer']);
  });
});
