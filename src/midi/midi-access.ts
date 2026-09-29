export type MidiStatus = 'idle' | 'requesting' | 'ready' | 'unsupported' | 'denied' | 'error';

interface MidiPortLike {
  readonly id: string;
  readonly name: string | null;
  readonly manufacturer?: string | null;
  readonly state: 'connected' | 'disconnected';
}

export interface MidiInputPortLike extends MidiPortLike {
  onmidimessage: ((event: { data: Uint8Array | null }) => void) | null;
}

export interface MidiOutputPortLike extends MidiPortLike {
  send(data: number[]): void;
}

interface MidiPortMapLike<T> {
  forEach(callback: (port: T) => void): void;
}

export interface MidiAccessLike {
  readonly inputs: MidiPortMapLike<MidiInputPortLike>;
  readonly outputs: MidiPortMapLike<MidiOutputPortLike>;
  onstatechange: (() => void) | null;
}

interface MidiNavigatorLike {
  requestMIDIAccess?: () => Promise<MidiAccessLike>;
  permissions?: {
    query(descriptor: { name: 'midi'; sysex: false }): Promise<{ state: 'granted' | 'denied' | 'prompt' }>;
  };
}

export interface MidiPortInfo {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly state: 'connected' | 'disconnected';
}

export interface MidiAccessSnapshot {
  readonly status: MidiStatus;
  readonly message: string;
  readonly inputs: readonly MidiPortInfo[];
  readonly outputs: readonly MidiPortInfo[];
}

export class WebMidiAccess {
  #access: MidiAccessLike | null = null;
  #initialization: Promise<void> | null = null;
  #status: MidiStatus = 'idle';
  #message = 'MIDI access has not been requested.';
  #snapshot: MidiAccessSnapshot = Object.freeze({
    status: 'idle', message: this.#message, inputs: Object.freeze([]), outputs: Object.freeze([]),
  });
  readonly #listeners = new Set<(snapshot: MidiAccessSnapshot) => void>();

  constructor(private readonly browserNavigator: MidiNavigatorLike = navigator as unknown as MidiNavigatorLike) {}

  snapshot(): MidiAccessSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: MidiAccessSnapshot) => void): () => void {
    this.#listeners.add(listener);
    this.#notify(listener, this.#snapshot);
    return () => { this.#listeners.delete(listener); };
  }

  findInput(id: string): MidiInputPortLike | null {
    return this.#findPort(this.#access?.inputs, id);
  }

  findOutput(id: string): MidiOutputPortLike | null {
    return this.#findPort(this.#access?.outputs, id);
  }

  async restoreIfPermitted(): Promise<void> {
    if (!this.browserNavigator.requestMIDIAccess) {
      await this.initialize();
      return;
    }
    try {
      const permission = await this.browserNavigator.permissions?.query({ name: 'midi', sysex: false });
      if (permission?.state === 'granted') {
        await this.initialize();
        return;
      }
    } catch {
      // Browser permission queries are not universally supported.
    }
    if (this.#status === 'idle') this.#setStatus('idle', 'Tap MIDI to connect.');
  }

  initialize(): Promise<void> {
    if (this.#access) return this.#initialization ?? Promise.resolve();
    if (this.#initialization) return this.#initialization;
    if (!this.browserNavigator.requestMIDIAccess) {
      this.#setStatus('unsupported', 'Web MIDI is not supported in this browser. Try Chrome or Edge.');
      return Promise.resolve();
    }
    let finishInitialization!: () => void;
    this.#initialization = new Promise<void>((resolve) => { finishInitialization = resolve; });
    this.#setStatus('requesting', 'Requesting MIDI access…');
    let request: Promise<MidiAccessLike>;
    try {
      request = this.browserNavigator.requestMIDIAccess();
    } catch (error) {
      request = Promise.reject(error);
    }
    void request.then((access) => {
      this.#access = access;
      access.onstatechange = () => this.#publish();
      this.#setStatus('ready', 'MIDI access granted. Select an output.');
      finishInitialization();
    }, (error: unknown) => {
      const denied = error instanceof DOMException
        && (error.name === 'SecurityError' || error.name === 'NotAllowedError');
      this.#initialization = null;
      this.#setStatus(denied ? 'denied' : 'error', denied ? 'MIDI access was denied.' : 'Could not access MIDI devices.');
      finishInitialization();
    });
    return this.#initialization;
  }

  #findPort<T extends MidiPortLike>(map: MidiPortMapLike<T> | undefined, id: string): T | null {
    let found: T | null = null;
    map?.forEach((port) => { if (port.id === id && port.state === 'connected') found = port; });
    return found;
  }

  #setStatus(status: MidiStatus, message: string): void {
    this.#status = status;
    this.#message = message;
    this.#publish();
  }

  #publish(): void {
    const inputs: MidiPortInfo[] = [];
    const outputs: MidiPortInfo[] = [];
    this.#access?.inputs.forEach((port) => this.#addConnected(inputs, port, 'input'));
    this.#access?.outputs.forEach((port) => this.#addConnected(outputs, port, 'output'));
    this.#snapshot = Object.freeze({
      status: this.#status,
      message: this.#message,
      inputs: Object.freeze(inputs),
      outputs: Object.freeze(outputs),
    });
    for (const listener of this.#listeners) this.#notify(listener, this.#snapshot);
  }

  #notify(listener: (snapshot: MidiAccessSnapshot) => void, snapshot: MidiAccessSnapshot): void {
    try {
      listener(snapshot);
    } catch {
      // A consumer callback must not interrupt access or other consumers.
    }
  }

  #addConnected(ports: MidiPortInfo[], port: MidiPortLike, direction: 'input' | 'output'): void {
    if (port.state !== 'connected') return;
    ports.push(Object.freeze({
      id: port.id,
      name: port.name ?? `Unnamed MIDI ${direction}`,
      manufacturer: port.manufacturer ?? '',
      state: port.state,
    }));
  }
}
