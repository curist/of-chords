import type { NoteSink } from './note-ledger';
import { WebMidiAccess, type MidiAccessSnapshot, type MidiOutputPortLike, type MidiPortInfo, type MidiStatus } from './midi-access';
import { getOptionalStorage, type StorageLike } from './storage';

export { getOptionalStorage, type StorageLike };

export interface MidiOutputSnapshot {
  readonly status: MidiStatus;
  readonly message: string;
  readonly outputs: readonly MidiPortInfo[];
  readonly selectedOutputId: string | null;
}

const STORAGE_KEY = 'webchords.midi-output-id';

export class WebMidiOutputManager implements NoteSink {
  #output: MidiOutputPortLike | null = null;
  #status: MidiStatus = 'idle';
  #message = 'MIDI access has not been requested.';
  #destinationWillChange: (() => void) | null = null;
  #destinationDidChange: (() => void) | null = null;
  #cleanupScheduled = false;
  readonly #listeners = new Set<(snapshot: MidiOutputSnapshot) => void>();
  readonly #unsubscribeAccess: () => void;

  constructor(
    private readonly access: WebMidiAccess,
    private readonly storage: StorageLike | null = getOptionalStorage(),
  ) {
    this.#unsubscribeAccess = access.subscribe((snapshot) => this.#onAccessSnapshot(snapshot));
  }

  snapshot(): MidiOutputSnapshot {
    return {
      status: this.#status,
      message: this.#message,
      outputs: this.access.snapshot().outputs,
      selectedOutputId: this.#output?.id ?? null,
    };
  }

  subscribe(listener: (snapshot: MidiOutputSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  onDestinationWillChange(listener: () => void): void {
    this.#destinationWillChange = listener;
  }

  onDestinationDidChange(listener: () => void): void {
    this.#destinationDidChange = listener;
  }

  restoreIfPermitted(): Promise<void> {
    return this.access.restoreIfPermitted();
  }

  initialize(): Promise<void> {
    return this.access.initialize();
  }

  dispose(): void {
    this.#unsubscribeAccess();
  }

  selectOutput(id: string | null): void {
    const nextOutput = id ? this.access.findOutput(id) : null;
    this.#changeOutput(nextOutput);
    if (this.#output) {
      this.#storageSet(this.#output.id);
      this.#message = `Connected to ${this.#output.name ?? 'MIDI output'}.`;
    } else {
      this.#storageRemove();
      this.#message = this.#status === 'ready' ? 'No MIDI output selected.' : this.#message;
    }
    this.#emit();
  }

  noteOn(note: number, velocity = 100): void {
    this.#send([0x90, note, velocity]);
  }

  noteOff(note: number): void {
    this.#send([0x80, note, 0]);
  }

  allNotesOff(): void {
    this.#send([0xb0, 123, 0]);
    this.#send([0xb0, 120, 0]);
  }

  programChange(program: number): void {
    this.#send([0xc0, program]);
  }

  #onAccessSnapshot(snapshot: MidiAccessSnapshot): void {
    this.#status = snapshot.status;
    this.#message = snapshot.message;
    if (snapshot.status === 'ready') {
      this.#refreshSelection(snapshot);
    } else {
      this.#emit();
    }
  }

  #refreshSelection(snapshot: MidiAccessSnapshot): void {
    const remembered = this.#storageGet();
    const selectedId = this.#output?.id ?? remembered;
    const nextOutput = selectedId ? this.access.findOutput(selectedId) : null;
    this.#changeOutput(nextOutput);
    this.#message = this.#output
      ? `Connected to ${this.#output.name ?? 'MIDI output'}.`
      : snapshot.outputs.length === 0 ? 'No MIDI outputs found.' : 'MIDI ready. Select an output.';
    this.#emit();
  }

  #changeOutput(nextOutput: MidiOutputPortLike | null): void {
    const changed = this.#output !== nextOutput;
    if (this.#output && changed) this.#destinationWillChange?.();
    this.#output = nextOutput;
    if (changed && nextOutput) {
      queueMicrotask(() => {
        if (this.#output === nextOutput) this.#destinationDidChange?.();
      });
    }
  }

  #send(data: number[]): void {
    if (!this.#output) return;
    try {
      this.#output.send(data);
    } catch {
      this.#output = null;
      this.#status = 'ready';
      this.#message = 'MIDI output became unavailable. Select an output to reconnect.';
      this.#emit();
      if (!this.#cleanupScheduled) {
        this.#cleanupScheduled = true;
        queueMicrotask(() => {
          this.#cleanupScheduled = false;
          this.#destinationWillChange?.();
        });
      }
    }
  }

  #storageGet(): string | null {
    try { return this.storage?.getItem(STORAGE_KEY) ?? null; } catch { return null; }
  }

  #storageSet(id: string): void {
    try { this.storage?.setItem(STORAGE_KEY, id); } catch { /* Preference storage is optional. */ }
  }

  #storageRemove(): void {
    try { this.storage?.removeItem(STORAGE_KEY); } catch { /* Preference storage is optional. */ }
  }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
