import { describe, expect, it } from 'vitest';
import { KeyboardInput, type KeyboardEventLike, type KeyboardEventTarget } from './keyboard';
import type { InstrumentAction } from '../state/instrument';

class FakeKeyboardTarget implements KeyboardEventTarget {
  readonly listeners = new Map<string, Set<(event: KeyboardEventLike) => void>>();
  addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEventLike) => void): void {
    const group = this.listeners.get(type) ?? new Set();
    group.add(listener);
    this.listeners.set(type, group);
  }
  removeEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEventLike) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: 'keydown' | 'keyup', code: string, repeat = false): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ code, repeat, preventDefault() {} });
  }
}

describe('KeyboardInput', () => {
  it('dispatches configured degree actions and suppresses browser repeats', () => {
    const target = new FakeKeyboardTarget();
    const actions: InstrumentAction[] = [];
    const detach = new KeyboardInput(target, (action) => actions.push(action)).attach();
    target.emit('keydown', 'KeyA');
    target.emit('keydown', 'KeyA', true);
    target.emit('keyup', 'KeyA');
    target.emit('keydown', 'KeyZ');
    target.emit('keydown', 'BracketLeft');
    target.emit('keydown', 'BracketRight');
    target.emit('keydown', 'BracketRight', true);
    detach();
    target.emit('keydown', 'KeyS');
    expect(actions).toEqual([
      { type: 'press', owner: 'keyboard:KeyA', degree: 1 },
      { type: 'release', owner: 'keyboard:KeyA' },
      { type: 'step-program', direction: -1 },
      { type: 'step-program', direction: 1 },
    ]);
  });
});
