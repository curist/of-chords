import { describe, expect, it, vi } from 'vitest';
import { OutputController, type OutputMode } from './output-controller';
import type { NoteSink } from '../midi/note-ledger';

class RecordingSink implements NoteSink {
  readonly events: string[] = [];
  noteOn(note: number, velocity = 100): void { this.events.push(`on:${note}:${velocity}`); }
  noteOff(note: number): void { this.events.push(`off:${note}`); }
  allNotesOff(): void { this.events.push('all-off'); }
}

class RecordingBuiltin extends RecordingSink {
  resume = vi.fn(async () => { this.events.push('resume'); });
}

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    read: (key: string) => map.get(key) ?? null,
  };
}

describe('OutputController', () => {
  it('defaults to the built-in voice and routes notes to it', () => {
    const builtin = new RecordingBuiltin();
    const midi = new RecordingSink();
    const output = new OutputController(builtin, midi);

    expect(output.mode).toBe('builtin');
    output.noteOn(60, 100);
    output.noteOff(60);
    output.allNotesOff();

    expect(builtin.events).toEqual(['on:60:100', 'off:60', 'all-off']);
    expect(midi.events).toEqual([]);
  });

  it('restores a persisted mode', () => {
    const output = new OutputController(new RecordingBuiltin(), new RecordingSink(), {
      storage: makeStorage({ 'webchords.output-mode': 'midi' }),
    });
    expect(output.mode).toBe('midi');
  });

  it('panics the old output before switching, then routes to the new one', () => {
    const builtin = new RecordingBuiltin();
    const midi = new RecordingSink();
    const willChange = vi.fn(() => builtin.allNotesOff());
    const didChange = vi.fn();
    const output = new OutputController(builtin, midi);
    output.onWillChange(willChange);
    output.onDidChange(didChange);

    output.noteOn(60);
    output.setMode('midi');
    output.noteOn(64);

    expect(willChange).toHaveBeenCalledOnce();
    expect(didChange).toHaveBeenCalledOnce();
    // Built-in got the first note plus the panic that fired before the switch.
    expect(builtin.events).toEqual(['on:60:100', 'all-off']);
    // The second note went to MIDI.
    expect(midi.events).toEqual(['on:64:100']);
  });

  it('persists and notifies subscribers when the mode changes', () => {
    const storage = makeStorage();
    const seen: OutputMode[] = [];
    const output = new OutputController(new RecordingBuiltin(), new RecordingSink(), { storage });
    output.subscribe((snapshot) => seen.push(snapshot.mode));

    output.setMode('midi');

    expect(seen).toEqual(['builtin', 'midi']);
    expect(storage.read('webchords.output-mode')).toBe('midi');
  });

  it('resumes built-in audio when selected, even if already the active mode', () => {
    const builtin = new RecordingBuiltin();
    const willChange = vi.fn();
    const output = new OutputController(builtin, new RecordingSink());
    output.onWillChange(willChange);

    output.setMode('builtin');

    expect(builtin.resume).toHaveBeenCalledOnce();
    expect(willChange).not.toHaveBeenCalled();
  });
});
