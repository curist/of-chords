import { scaleDegreeForPitchClass } from '../music/scales';
import type { InstrumentAction, InstrumentState } from '../state/instrument';
import { WebMidiAccess, type MidiAccessSnapshot, type MidiInputPortLike, type MidiPortInfo, type MidiStatus } from './midi-access';
import { PersistedDevicePreference } from './device-preference';
import { getOptionalStorage, type StorageLike } from './storage';

export interface MidiNoteMessage {
  readonly kind: 'on' | 'off';
  readonly channel: number;
  readonly note: number;
  readonly velocity: number;
}

export function parseMidiNoteMessage(data: ArrayLike<number>): MidiNoteMessage | null {
  if (data.length !== 3) return null;
  const status = data[0];
  const note = data[1];
  const velocity = data[2];
  if (!Number.isInteger(status) || status < 0x80 || status > 0xff) return null;
  if (!Number.isInteger(note) || note < 0 || note > 127) return null;
  if (!Number.isInteger(velocity) || velocity < 0 || velocity > 127) return null;
  const command = status & 0xf0;
  if (command !== 0x80 && command !== 0x90) return null;
  return {
    kind: command === 0x90 && velocity > 0 ? 'on' : 'off',
    channel: status & 0x0f,
    note,
    velocity,
  };
}

export type MidiInputStatus = MidiStatus | 'disconnected' | 'suspended';

export interface MidiInputSnapshot {
  readonly status: MidiInputStatus;
  readonly message: string;
  readonly inputs: readonly MidiPortInfo[];
  readonly preferredInputId: string | null;
  readonly preferredInputLabel: string | null;
  readonly attachedInputId: string | null;
}

export interface MidiInputOptions {
  readonly storage?: StorageLike | null;
  readonly now?: () => number;
}

const STORAGE_KEY = 'webchords.midi-input-id';
const LABEL_STORAGE_KEY = 'webchords.midi-input-label';
const SUSPENDED_MESSAGE = 'Possible MIDI feedback loop detected. Check MIDI routing, then resume input.';

export class WebMidiInputManager {
  #preferredInputId: string | null;
  #input: MidiInputPortLike | null = null;
  #status: MidiInputStatus = 'idle';
  #message = 'MIDI access has not been requested.';
  #suspended = false;
  #disposed = false;
  #timestamps: number[] = [];
  readonly #cleanupCandidates = new Set<string>();
  readonly #listeners = new Set<(snapshot: MidiInputSnapshot) => void>();
  readonly #unsubscribeAccess: () => void;
  readonly #preference: PersistedDevicePreference;
  readonly #now: () => number;

  constructor(
    private readonly access: WebMidiAccess,
    private readonly getHarmony: () => Pick<InstrumentState, 'tonic' | 'mode'>,
    private readonly dispatch: (action: InstrumentAction) => void,
    options: MidiInputOptions = {},
  ) {
    this.#preference = new PersistedDevicePreference(
      options.storage === undefined ? getOptionalStorage() : options.storage,
      STORAGE_KEY,
      LABEL_STORAGE_KEY,
    );
    this.#now = options.now ?? (() => performance.now());
    this.#preferredInputId = this.#preference.id();
    this.#unsubscribeAccess = access.subscribe((snapshot) => this.#onAccessSnapshot(snapshot));
  }

  snapshot(): MidiInputSnapshot {
    return {
      status: this.#status,
      message: this.#message,
      inputs: this.access.snapshot().inputs,
      preferredInputId: this.#preferredInputId,
      preferredInputLabel: this.#input ? this.#inputLabel(this.#input) : this.#preference.label(),
      attachedInputId: this.#input?.id ?? null,
    };
  }

  subscribe(listener: (snapshot: MidiInputSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  selectInput(id: string | null): void {
    if (this.#disposed) return;
    this.#preferredInputId = id;
    if (id === null) {
      this.#preference.clear();
    } else {
      const input = this.access.findInput(id);
      this.#preference.set(id, input ? this.#inputLabel(input) : id);
    }
    this.#refresh(this.access.snapshot());
  }

  resume(): void {
    if (this.#disposed || !this.#suspended) return;
    this.#suspended = false;
    this.#timestamps = [];
    this.#refresh(this.access.snapshot());
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#changeInput(null);
    this.#unsubscribeAccess();
    this.#listeners.clear();
  }

  #onAccessSnapshot(snapshot: MidiAccessSnapshot): void {
    if (this.#disposed) return;
    this.#refresh(snapshot);
  }

  #refresh(snapshot: MidiAccessSnapshot): void {
    if (this.#suspended) {
      this.#changeInput(null);
      this.#status = 'suspended';
      this.#message = SUSPENDED_MESSAGE;
    } else if (snapshot.status === 'ready') {
      const input = this.#preferredInputId ? this.access.findInput(this.#preferredInputId) : null;
      this.#changeInput(input);
      this.#status = this.#preferredInputId && !input ? 'disconnected' : 'ready';
      this.#message = input
        ? `Connected to ${input.name ?? 'MIDI input'}.`
        : this.#preferredInputId
          ? 'Preferred MIDI input disconnected. Reconnect it to continue.'
          : snapshot.inputs.length === 0 ? 'No MIDI inputs found.' : 'MIDI ready. Select an input.';
    } else {
      this.#changeInput(null);
      this.#status = snapshot.status;
      this.#message = snapshot.message;
    }
    this.#emit();
  }

  #changeInput(next: MidiInputPortLike | null): void {
    if (this.#input === next) return;
    if (this.#input) {
      this.#releaseCandidates();
      this.#input.onmidimessage = null;
    }
    this.#input = next;
    this.#timestamps = [];
    if (next) next.onmidimessage = (event) => {
      if (this.#input === next) this.#onMessage(event.data);
    };
  }

  #onMessage(data: Uint8Array | null): void {
    if (!data || !this.#input || this.#suspended || this.#disposed) return;
    const message = parseMidiNoteMessage(data);
    if (!message) return;
    const owner = `midi:${this.#input.id}:ch:${message.channel}:note:${message.note}`;
    if (message.kind === 'off') {
      try {
        this.dispatch({ type: 'release', owner });
        this.#cleanupCandidates.delete(owner);
      } catch {
        // Keep the candidate for cleanup on a later port change.
      }
      return;
    }
    const now = this.#now();
    this.#timestamps = this.#timestamps.filter((time) => now - time < 100);
    this.#timestamps.push(now);
    if (this.#timestamps.length > 64) {
      this.#suspend();
      return;
    }
    this.#cleanupCandidates.add(owner);
    try {
      const { tonic, mode } = this.getHarmony();
      const degree = scaleDegreeForPitchClass(tonic, mode, message.note % 12);
      this.dispatch(degree === null
        ? { type: 'press-note', owner, note: message.note, velocity: message.velocity }
        : { type: 'press', owner, degree, velocity: message.velocity, bassNote: message.note });
    } catch {
      // A bad message or dispatch callback must not disable the input.
    }
  }

  #suspend(): void {
    this.#suspended = true;
    if (this.#input) this.#input.onmidimessage = null;
    this.#input = null;
    this.#releaseCandidates();
    // Panic is intentionally global: a feedback loop must silence every held note
    // (keyboard/pointer/gamepad included), not only MIDI-owned gestures.
    try { this.dispatch({ type: 'panic' }); } catch { /* Keep the breaker active. */ }
    this.#status = 'suspended';
    this.#message = SUSPENDED_MESSAGE;
    this.#emit();
  }

  #releaseCandidates(): void {
    for (const owner of this.#cleanupCandidates) {
      try { this.dispatch({ type: 'release', owner }); } catch { /* Continue releasing other owners. */ }
    }
    this.#cleanupCandidates.clear();
  }

  #inputLabel(input: MidiInputPortLike): string {
    return `${input.name ?? 'Unnamed MIDI input'}${input.manufacturer ? ` · ${input.manufacturer}` : ''}`;
  }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
