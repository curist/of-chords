/**
 * A destination for note events. The ledger and the rest of the performance
 * engine only speak in terms of note-on / note-off / all-notes-off, so any
 * output (Web MIDI, the built-in Web Audio synth, a test double) can implement
 * this and be swapped in without the harmony logic knowing which is active.
 */
export interface NoteSink {
  noteOn(note: number, velocity?: number): void;
  noteOff(note: number): void;
  allNotesOff(): void;
}

/** @deprecated Retained alias for the generalized {@link NoteSink}. */
export type MidiNoteSink = NoteSink;

export class NoteLedger {
  readonly #owners = new Map<string, readonly number[]>();
  readonly #references = new Map<number, number>();

  constructor(private readonly sink: NoteSink) {}

  get activeOwnerCount(): number {
    return this.#owners.size;
  }

  acquire(owner: string, notes: readonly number[]): void {
    if (this.#owners.has(owner)) return;
    const uniqueNotes = [...new Set(notes)];
    this.#owners.set(owner, uniqueNotes);
    for (const note of uniqueNotes) {
      const count = this.#references.get(note) ?? 0;
      this.#references.set(note, count + 1);
      if (count === 0) this.#attempt(() => this.sink.noteOn(note));
    }
  }

  release(owner: string): void {
    const notes = this.#owners.get(owner);
    if (!notes) return;
    this.#owners.delete(owner);
    for (const note of notes) {
      const count = this.#references.get(note) ?? 0;
      if (count <= 1) {
        this.#references.delete(note);
        this.#attempt(() => this.sink.noteOff(note));
      } else {
        this.#references.set(note, count - 1);
      }
    }
  }

  panic(): void {
    const notes = [...this.#references.keys()].sort((a, b) => a - b);
    this.#owners.clear();
    this.#references.clear();
    for (const note of notes) this.#attempt(() => this.sink.noteOff(note));
    this.#attempt(() => this.sink.allNotesOff());
  }

  #attempt(operation: () => void): void {
    try {
      operation();
    } catch {
      // Ownership must remain internally consistent even when a device disappears.
    }
  }
}
