import type { NoteSink } from './note-ledger';

interface MidiPortLike {
  readonly id: string;
  readonly name: string | null;
  readonly manufacturer?: string | null;
  readonly state: 'connected' | 'disconnected';
  send(data: number[]): void;
}

interface MidiOutputMapLike {
  forEach(callback: (output: MidiPortLike) => void): void;
}

interface MidiAccessLike {
  readonly outputs: MidiOutputMapLike;
  onstatechange: (() => void) | null;
}

interface MidiNavigator {
  requestMIDIAccess?: () => Promise<MidiAccessLike>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MidiOutputInfo {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly state: 'connected' | 'disconnected';
}

export type MidiStatus = 'idle' | 'requesting' | 'ready' | 'unsupported' | 'denied' | 'error';

export interface MidiOutputSnapshot {
  readonly status: MidiStatus;
  readonly message: string;
  readonly outputs: readonly MidiOutputInfo[];
  readonly selectedOutputId: string | null;
}

const STORAGE_KEY = 'webchords.midi-output-id';

export function getOptionalStorage(provider: () => StorageLike = () => localStorage): StorageLike | null {
  try {
    return provider();
  } catch {
    return null;
  }
}

export class WebMidiOutputManager implements NoteSink {
  #access: MidiAccessLike | null = null;
  #output: MidiPortLike | null = null;
  #status: MidiStatus = 'idle';
  #message = 'MIDI access has not been requested.';
  #destinationWillChange: (() => void) | null = null;
  #destinationDidChange: (() => void) | null = null;
  #cleanupScheduled = false;
  readonly #listeners = new Set<(snapshot: MidiOutputSnapshot) => void>();

  constructor(
    private readonly browserNavigator: MidiNavigator = navigator as MidiNavigator,
    private readonly storage: StorageLike | null = getOptionalStorage(),
  ) {}

  snapshot(): MidiOutputSnapshot {
    const outputs: MidiOutputInfo[] = [];
    this.#access?.outputs.forEach((output) => {
      if (output.state !== 'connected') return;
      outputs.push({
        id: output.id,
        name: output.name ?? 'Unnamed MIDI output',
        manufacturer: output.manufacturer ?? '',
        state: output.state,
      });
    });
    return {
      status: this.#status,
      message: this.#message,
      outputs,
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

  async initialize(): Promise<void> {
    if (!this.browserNavigator.requestMIDIAccess) {
      this.#setStatus('unsupported', 'Web MIDI is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    if (this.#status === 'requesting' || this.#status === 'ready') return;
    this.#setStatus('requesting', 'Requesting MIDI access…');
    try {
      const access = await this.browserNavigator.requestMIDIAccess();
      this.#access = access;
      access.onstatechange = () => this.#refreshSelection();
      this.#setStatus('ready', 'MIDI access granted. Select an output.');
      this.#refreshSelection();
    } catch (error) {
      const denied = error instanceof DOMException
        && (error.name === 'SecurityError' || error.name === 'NotAllowedError');
      this.#setStatus(denied ? 'denied' : 'error', denied ? 'MIDI access was denied.' : 'Could not access MIDI devices.');
    }
  }

  selectOutput(id: string | null): void {
    const nextOutput = id && this.#access ? this.#findOutput(id) : null;
    this.#changeOutput(nextOutput);
    if (this.#output) {
      this.#storageSet(this.#output.id);
      this.#message = `Connected to ${this.#output.name ?? 'MIDI output'}.`;
    } else {
      this.#storageRemove();
      this.#message = this.#access ? 'No MIDI output selected.' : this.#message;
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

  #refreshSelection(): void {
    if (!this.#access) return;
    const remembered = this.#storageGet();
    const selectedId = this.#output?.id ?? remembered;
    const nextOutput = selectedId ? this.#findOutput(selectedId) : null;
    this.#changeOutput(nextOutput);
    let count = 0;
    this.#access.outputs.forEach((output) => { if (output.state === 'connected') count += 1; });
    this.#message = this.#output
      ? `Connected to ${this.#output.name ?? 'MIDI output'}.`
      : count === 0 ? 'No MIDI outputs found.' : 'MIDI ready. Select an output.';
    this.#emit();
  }

  #setStatus(status: MidiStatus, message: string): void {
    this.#status = status;
    this.#message = message;
    this.#emit();
  }

  #findOutput(id: string): MidiPortLike | null {
    let found: MidiPortLike | null = null;
    this.#access?.outputs.forEach((output) => {
      if (output.id === id && output.state === 'connected') found = output;
    });
    return found;
  }

  #changeOutput(nextOutput: MidiPortLike | null): void {
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
