import type { ScaleDegree } from '../music/chords';
import type { InstrumentAction } from '../state/instrument';

export type GamepadInputStatus = 'waiting' | 'activating' | 'ready';

export function describeGamepadStatus(status: GamepadInputStatus): string {
  switch (status) {
    case 'waiting': return 'Press A to connect controller';
    case 'activating': return 'Release controller buttons';
    case 'ready': return 'Controller ready';
  }
}

export interface GamepadButtonLike {
  readonly pressed: boolean;
  readonly value: number;
}

export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly buttons: readonly GamepadButtonLike[];
}

export interface GamepadNavigator {
  getGamepads(): readonly (GamepadLike | null)[];
}

export interface GamepadEventLike {
  readonly gamepad: GamepadLike;
}

export interface GamepadEventTarget {
  addEventListener(type: 'gamepadconnected' | 'gamepaddisconnected', listener: (event: GamepadEventLike) => void): void;
  removeEventListener(type: 'gamepadconnected' | 'gamepaddisconnected', listener: (event: GamepadEventLike) => void): void;
}

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(id: number): void;
}

const DEGREE_BUTTONS: ReadonlyMap<number, ScaleDegree> = new Map([
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 7],
]);

interface ControllerState {
  status: 'activating' | 'ready';
  readonly pressed: Set<number>;
}

export class GamepadInput {
  readonly #controllers = new Map<number, ControllerState>();
  #frameId: number | null = null;

  constructor(
    private readonly target: GamepadEventTarget,
    private readonly navigator: GamepadNavigator,
    private readonly frames: FrameScheduler,
    private readonly dispatch: (action: InstrumentAction) => void,
    private readonly updateStatus: (status: GamepadInputStatus) => void,
  ) {}

  attach(): () => void {
    const connected = (event: GamepadEventLike) => this.#connect(event.gamepad);
    const disconnected = (event: GamepadEventLike) => this.#disconnect(event.gamepad.index);
    this.target.addEventListener('gamepadconnected', connected);
    this.target.addEventListener('gamepaddisconnected', disconnected);
    this.updateStatus('waiting');

    const poll = () => {
      for (const gamepad of this.navigator.getGamepads()) {
        if (!gamepad?.connected) continue;
        if (!this.#controllers.has(gamepad.index)) this.#connect(gamepad);
        this.#update(gamepad);
      }
      this.#frameId = this.frames.request(poll);
    };
    this.#frameId = this.frames.request(poll);

    return () => {
      this.target.removeEventListener('gamepadconnected', connected);
      this.target.removeEventListener('gamepaddisconnected', disconnected);
      if (this.#frameId !== null) this.frames.cancel(this.#frameId);
      for (const index of [...this.#controllers.keys()]) this.#disconnect(index);
    };
  }

  #connect(gamepad: GamepadLike): void {
    if (this.#controllers.has(gamepad.index)) return;
    this.#controllers.set(gamepad.index, {
      status: 'activating',
      pressed: new Set(),
    });
    this.updateStatus('activating');
  }

  #update(gamepad: GamepadLike): void {
    const controller = this.#controllers.get(gamepad.index);
    if (!controller) return;
    if (controller.status === 'activating') {
      const stillPressed = [...DEGREE_BUTTONS.keys()].some((index) => gamepad.buttons[index]?.pressed);
      if (!stillPressed) {
        controller.status = 'ready';
        this.updateStatus('ready');
      }
      return;
    }

    for (const [buttonIndex, degree] of DEGREE_BUTTONS) {
      const pressed = Boolean(gamepad.buttons[buttonIndex]?.pressed);
      const wasPressed = controller.pressed.has(buttonIndex);
      const owner = `gamepad:${gamepad.index}:button:${buttonIndex}`;
      if (pressed && !wasPressed) {
        controller.pressed.add(buttonIndex);
        this.dispatch({ type: 'press', owner, degree });
      } else if (!pressed && wasPressed) {
        controller.pressed.delete(buttonIndex);
        this.dispatch({ type: 'release', owner });
      }
    }
  }

  #disconnect(index: number): void {
    const controller = this.#controllers.get(index);
    if (!controller) return;
    for (const buttonIndex of controller.pressed) {
      this.dispatch({ type: 'release', owner: `gamepad:${index}:button:${buttonIndex}` });
    }
    this.#controllers.delete(index);
    this.updateStatus(this.#controllers.size ? 'ready' : 'waiting');
  }
}
