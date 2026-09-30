import type { NoteSink } from './note-ledger';
import { WebMidiAccess, type MidiAccessSnapshot, type MidiOutputPortLike, type MidiPortInfo, type MidiStatus } from './midi-access';
import { PersistedDevicePreference } from './device-preference';
import { getOptionalStorage, type StorageLike } from './storage';

export interface MidiOutputSnapshot {
  readonly status: MidiStatus;
  readonly message: string;
  readonly outputs: readonly MidiPortInfo[];
  readonly selectedOutputId: string | null;
  readonly preferredOutputId: string | null;
  readonly preferredOutputLabel: string | null;
}

const STORAGE_KEY = 'webchords.midi-output-id';
const LABEL_STORAGE_KEY = 'webchords.midi-output-label';
type Unsubscribe = () => void;

export class WebMidiOutputManager implements NoteSink {
  #output: MidiOutputPortLike | null = null;
  #status: MidiStatus = 'idle';
  #message = 'MIDI access has not been requested.';
  readonly #destinationWillChange = new Set<() => void>();
  readonly #destinationDidChange = new Set<() => void>();
  #cleanupScheduled = false;
  readonly #listeners = new Set<(snapshot: MidiOutputSnapshot) => void>();
  readonly #unsubscribeAccess: () => void;
  readonly #preference: PersistedDevicePreference;

  constructor(
    private readonly access: WebMidiAccess,
    storage: StorageLike | null = getOptionalStorage(),
  ) {
    this.#preference = new PersistedDevicePreference(storage, STORAGE_KEY, LABEL_STORAGE_KEY);
    this.#unsubscribeAccess = access.subscribe((snapshot) => this.#onAccessSnapshot(snapshot));
  }

  snapshot(): MidiOutputSnapshot {
    return {
      status: this.#status,
      message: this.#message,
      outputs: this.access.snapshot().outputs,
      selectedOutputId: this.#output?.id ?? null,
      preferredOutputId: this.#output?.id ?? this.#preference.id(),
      preferredOutputLabel: this.#output ? this.#outputLabel(this.#output) : this.#preference.label(),
    };
  }

  subscribe(listener: (snapshot: MidiOutputSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  onDestinationWillChange(listener: () => void): Unsubscribe {
    this.#destinationWillChange.add(listener);
    return () => { this.#destinationWillChange.delete(listener); };
  }

  onDestinationDidChange(listener: () => void): Unsubscribe {
    this.#destinationDidChange.add(listener);
    return () => { this.#destinationDidChange.delete(listener); };
  }

  restoreIfPermitted(): Promise<void> {
    return this.access.restoreIfPermitted();
  }

  initialize(): Promise<void> {
    return this.access.initialize();
  }

  dispose(): void {
    this.#unsubscribeAccess();
    this.#listeners.clear();
    this.#destinationWillChange.clear();
    this.#destinationDidChange.clear();
  }

  selectOutput(id: string | null): void {
    const nextOutput = id ? this.access.findOutput(id) : null;
    this.#changeOutput(nextOutput);
    if (this.#output) {
      this.#preference.set(this.#output.id, this.#outputLabel(this.#output));
      this.#message = `Connected to ${this.#output.name ?? 'MIDI output'}.`;
    } else {
      this.#preference.clear();
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
    const remembered = this.#preference.id();
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
    if (this.#output && changed) {
      for (const listener of this.#destinationWillChange) listener();
    }
    this.#output = nextOutput;
    if (changed && nextOutput) {
      queueMicrotask(() => {
        if (this.#output === nextOutput) {
          for (const listener of this.#destinationDidChange) listener();
        }
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
          for (const listener of this.#destinationWillChange) listener();
        });
      }
    }
  }

  #outputLabel(output: MidiOutputPortLike): string {
    return `${output.name ?? 'Unnamed MIDI output'}${output.manufacturer ? ` · ${output.manufacturer}` : ''}`;
  }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
