import { describe, expect, it } from 'vitest';
import { describeGamepadStatus, GamepadInput, type GamepadEventLike, type GamepadEventTarget, type GamepadLike, type GamepadNavigator, type FrameScheduler } from './gamepad';
import type { InstrumentAction } from '../state/instrument';

class FakeGamepadTarget implements GamepadEventTarget {
  readonly listeners = new Map<string, Set<(event: GamepadEventLike) => void>>();

  addEventListener(type: 'gamepadconnected' | 'gamepaddisconnected', listener: (event: GamepadEventLike) => void): void {
    const group = this.listeners.get(type) ?? new Set();
    group.add(listener);
    this.listeners.set(type, group);
  }

  removeEventListener(type: 'gamepadconnected' | 'gamepaddisconnected', listener: (event: GamepadEventLike) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: 'gamepadconnected' | 'gamepaddisconnected', gamepad: GamepadLike): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ gamepad });
  }
}

class FakeFrames implements FrameScheduler {
  #nextId = 1;
  #callbacks = new Map<number, () => void>();

  request(callback: () => void): number {
    const id = this.#nextId++;
    this.#callbacks.set(id, callback);
    return id;
  }

  cancel(id: number): void {
    this.#callbacks.delete(id);
  }

  run(): void {
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    callbacks.forEach((callback) => callback());
  }
}

function gamepad(index: number, pressed: readonly number[] = []): GamepadLike {
  return {
    id: 'Retroid Pocket Controller (Vendor: 2022 Product: 3001)',
    index,
    connected: true,
    buttons: Array.from({ length: 17 }, (_, buttonIndex) => ({
      pressed: pressed.includes(buttonIndex),
      value: pressed.includes(buttonIndex) ? 1 : 0,
    })),
  };
}

describe('GamepadInput', () => {
  it('uses the first controller press only to activate, then dispatches later button edges', () => {
    const target = new FakeGamepadTarget();
    const frames = new FakeFrames();
    let current: GamepadLike | null = null;
    const navigator: GamepadNavigator = { getGamepads: () => [current] };
    const actions: InstrumentAction[] = [];
    const statuses: string[] = [];
    const detach = new GamepadInput(target, navigator, frames, (action) => actions.push(action), (status) => statuses.push(status)).attach();

    current = gamepad(0, [0]);
    target.emit('gamepadconnected', current);
    frames.run();
    current = gamepad(0);
    frames.run();
    current = gamepad(0, [1]);
    frames.run();
    current = gamepad(0);
    frames.run();

    expect(actions).toEqual([
      { type: 'press', owner: 'gamepad:0:button:1', degree: 2 },
      { type: 'release', owner: 'gamepad:0:button:1' },
    ]);
    expect(statuses).toEqual(['waiting', 'activating', 'ready']);
    detach();
  });

  it('maps seven Retroid buttons to degrees and releases held owners on disconnect', () => {
    const target = new FakeGamepadTarget();
    const frames = new FakeFrames();
    let current: GamepadLike | null = gamepad(2);
    const actions: InstrumentAction[] = [];
    new GamepadInput(
      target,
      { getGamepads: () => [null, null, current] },
      frames,
      (action) => actions.push(action),
      () => {},
    ).attach();

    target.emit('gamepadconnected', current);
    frames.run();
    current = gamepad(2, [0, 1, 2, 3, 4, 5, 6]);
    frames.run();
    target.emit('gamepaddisconnected', current);

    expect(actions).toEqual([
      { type: 'press', owner: 'gamepad:2:button:0', degree: 1 },
      { type: 'press', owner: 'gamepad:2:button:1', degree: 2 },
      { type: 'press', owner: 'gamepad:2:button:2', degree: 3 },
      { type: 'press', owner: 'gamepad:2:button:3', degree: 4 },
      { type: 'press', owner: 'gamepad:2:button:4', degree: 5 },
      { type: 'press', owner: 'gamepad:2:button:5', degree: 6 },
      { type: 'press', owner: 'gamepad:2:button:6', degree: 7 },
      { type: 'release', owner: 'gamepad:2:button:0' },
      { type: 'release', owner: 'gamepad:2:button:1' },
      { type: 'release', owner: 'gamepad:2:button:2' },
      { type: 'release', owner: 'gamepad:2:button:3' },
      { type: 'release', owner: 'gamepad:2:button:4' },
      { type: 'release', owner: 'gamepad:2:button:5' },
      { type: 'release', owner: 'gamepad:2:button:6' },
    ]);
  });
});

describe('gamepad status', () => {
  it('gives the player an activation instruction until the controller is ready', () => {
    expect(describeGamepadStatus('waiting')).toBe('Press A to connect controller');
    expect(describeGamepadStatus('activating')).toBe('Release controller buttons');
    expect(describeGamepadStatus('ready')).toBe('Controller ready');
  });
});
