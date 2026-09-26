import { createInitialState, reduceInstrument, type InstrumentAction, type InstrumentEffect, type InstrumentState } from './instrument';

export interface InstrumentEffectTarget {
  acquire(owner: string, notes: readonly number[]): void;
  release(owner: string): void;
  panic(): void;
  programChange(program: number): void;
}

export class InstrumentStore {
  #state: InstrumentState;
  readonly #listeners = new Set<(state: InstrumentState) => void>();

  constructor(
    private readonly target: InstrumentEffectTarget,
    initialState: InstrumentState = createInitialState(),
  ) {
    this.#state = initialState;
  }

  getState(): InstrumentState {
    return this.#state;
  }

  subscribe(listener: (state: InstrumentState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  dispatch(action: InstrumentAction): void {
    const previous = this.#state;
    const transition = reduceInstrument(previous, action);
    this.#state = transition.state;
    transition.effects.forEach((effect) => this.#runEffect(effect));
    if (previous !== this.#state) {
      for (const listener of this.#listeners) listener(this.#state);
    }
  }

  #runEffect(effect: InstrumentEffect): void {
    switch (effect.type) {
      case 'acquire': this.target.acquire(effect.owner, effect.notes); break;
      case 'release': this.target.release(effect.owner); break;
      case 'program-change': this.target.programChange(effect.program); break;
      case 'panic': this.target.panic(); break;
    }
  }
}
