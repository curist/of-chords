import { CHORD_BINDINGS } from '../config';
import type { InstrumentAction } from '../state/instrument';

export interface KeyboardEventLike {
  readonly code: string;
  readonly repeat: boolean;
  preventDefault(): void;
}

export interface KeyboardEventTarget {
  addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEventLike) => void): void;
  removeEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEventLike) => void): void;
}

export class KeyboardInput {
  readonly #degrees = new Map(CHORD_BINDINGS.map((binding) => [binding.code, binding.degree]));

  constructor(
    private readonly target: KeyboardEventTarget,
    private readonly dispatch: (action: InstrumentAction) => void,
  ) {}

  attach(): () => void {
    const keydown = (event: KeyboardEventLike) => {
      const degree = this.#degrees.get(event.code);
      if (!degree || event.repeat) return;
      event.preventDefault();
      this.dispatch({ type: 'press', owner: `keyboard:${event.code}`, degree });
    };
    const keyup = (event: KeyboardEventLike) => {
      if (!this.#degrees.has(event.code)) return;
      event.preventDefault();
      this.dispatch({ type: 'release', owner: `keyboard:${event.code}` });
    };
    this.target.addEventListener('keydown', keydown);
    this.target.addEventListener('keyup', keyup);
    return () => {
      this.target.removeEventListener('keydown', keydown);
      this.target.removeEventListener('keyup', keyup);
    };
  }
}
