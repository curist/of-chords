import type { NoteSink } from '../midi/note-ledger';

export type OutputMode = 'builtin' | 'midi';

export interface OutputSnapshot {
  readonly mode: OutputMode;
}

/** The built-in synth also needs a user gesture to resume its AudioContext. */
export interface BuiltinNoteSink extends NoteSink {
  resume(): Promise<void>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OutputControllerOptions {
  readonly mode?: OutputMode;
  readonly storage?: StorageLike | null;
}

const STORAGE_KEY = 'webchords.output-mode';

/**
 * Routes the performance engine's note events to one output at a time — the
 * built-in Web Audio voice or Web MIDI — so the harmony logic never has to know
 * which is active. Switching outputs panics the old one first so no voice hangs.
 */
export class OutputController implements NoteSink {
  #mode: OutputMode;
  #active: NoteSink;
  #willChange: (() => void) | null = null;
  #didChange: (() => void) | null = null;
  readonly #listeners = new Set<(snapshot: OutputSnapshot) => void>();

  constructor(
    private readonly builtin: BuiltinNoteSink,
    private readonly midi: NoteSink,
    private readonly options: OutputControllerOptions = {},
  ) {
    this.#mode = options.mode ?? this.#readStoredMode() ?? 'builtin';
    this.#active = this.#sinkFor(this.#mode);
  }

  get mode(): OutputMode {
    return this.#mode;
  }

  snapshot(): OutputSnapshot {
    return { mode: this.#mode };
  }

  subscribe(listener: (snapshot: OutputSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  /** Fired before the active output changes, so callers can release held notes. */
  onWillChange(listener: () => void): void {
    this.#willChange = listener;
  }

  /** Fired after the active output changes, e.g. to resend a MIDI patch. */
  onDidChange(listener: () => void): void {
    this.#didChange = listener;
  }

  setMode(mode: OutputMode): void {
    if (mode === this.#mode) {
      // Re-selecting built-in is still a user gesture — a good moment to resume.
      if (mode === 'builtin') void this.builtin.resume();
      return;
    }
    this.#willChange?.();
    this.#mode = mode;
    this.#active = this.#sinkFor(mode);
    if (mode === 'builtin') void this.builtin.resume();
    this.#storeMode(mode);
    this.#emit();
    this.#didChange?.();
  }

  noteOn(note: number, velocity?: number): void {
    this.#active.noteOn(note, velocity);
  }

  noteOff(note: number): void {
    this.#active.noteOff(note);
  }

  allNotesOff(): void {
    this.#active.allNotesOff();
  }

  #sinkFor(mode: OutputMode): NoteSink {
    return mode === 'builtin' ? this.builtin : this.midi;
  }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }

  #readStoredMode(): OutputMode | null {
    try {
      const value = this.options.storage?.getItem(STORAGE_KEY);
      return value === 'builtin' || value === 'midi' ? value : null;
    } catch {
      return null;
    }
  }

  #storeMode(mode: OutputMode): void {
    try {
      this.options.storage?.setItem(STORAGE_KEY, mode);
    } catch {
      // Preference storage is optional.
    }
  }
}
