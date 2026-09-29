import { describe, expect, it } from 'vitest';
import { NoteLedger, type MidiNoteSink } from './note-ledger';

class RecordingSink implements MidiNoteSink {
  readonly events: string[] = [];
  noteOn(note: number, velocity?: number): void { this.events.push(`on:${note}:${velocity}`); }
  noteOff(note: number): void { this.events.push(`off:${note}`); }
  allNotesOff(): void { this.events.push('all-off'); }
}

describe('NoteLedger', () => {
  it('keeps a shared note sounding until its last owner releases', () => {
    const sink = new RecordingSink();
    const ledger = new NoteLedger(sink);
    ledger.acquire('one', [48, 52, 55]);
    ledger.acquire('two', [55, 59, 62]);
    ledger.release('one');
    expect(sink.events).toEqual(['on:48:100', 'on:52:100', 'on:55:100', 'on:59:100', 'on:62:100', 'off:48', 'off:52']);
    ledger.release('two');
    expect(sink.events.slice(-3)).toEqual(['off:55', 'off:59', 'off:62']);
  });

  it('ignores duplicate acquisition by the same owner', () => {
    const sink = new RecordingSink();
    const ledger = new NoteLedger(sink);
    ledger.acquire('keyboard:a', [48, 52, 55]);
    ledger.acquire('keyboard:a', [48, 52, 55]);
    ledger.release('keyboard:a');
    expect(sink.events).toEqual(['on:48:100', 'on:52:100', 'on:55:100', 'off:48', 'off:52', 'off:55']);
  });

  it('uses the first owner velocity for shared notes and a fresh velocity after final release', () => {
    const sink = new RecordingSink();
    const ledger = new NoteLedger(sink);
    ledger.acquire('first', [61], 73);
    ledger.acquire('shared', [61], 28);
    expect(sink.events).toEqual(['on:61:73']);
    ledger.release('first');
    expect(sink.events).toEqual(['on:61:73']);
    ledger.release('shared');
    ledger.acquire('later', [61], 45);
    expect(sink.events).toEqual(['on:61:73', 'off:61', 'on:61:45']);
  });

  it('panic releases tracked notes once and sends all notes off', () => {
    const sink = new RecordingSink();
    const ledger = new NoteLedger(sink);
    ledger.acquire('one', [48, 52, 55]);
    ledger.acquire('two', [55, 59]);
    ledger.panic();
    expect(sink.events).toEqual([
      'on:48:100', 'on:52:100', 'on:55:100', 'on:59:100',
      'off:48', 'off:52', 'off:55', 'off:59', 'all-off',
    ]);
    expect(ledger.activeOwnerCount).toBe(0);
  });

  it('clears ownership even when the transport throws during panic', () => {
    const attempted: string[] = [];
    const sink: MidiNoteSink = {
      noteOn() {},
      noteOff(note) { attempted.push(`off:${note}`); throw new DOMException('gone', 'InvalidStateError'); },
      allNotesOff() { attempted.push('all-off'); throw new DOMException('gone', 'InvalidStateError'); },
    };
    const ledger = new NoteLedger(sink);
    ledger.acquire('owner', [48, 52, 55]);
    expect(() => ledger.panic()).not.toThrow();
    expect(ledger.activeOwnerCount).toBe(0);
    expect(attempted).toEqual(['off:48', 'off:52', 'off:55', 'all-off']);
  });
});
