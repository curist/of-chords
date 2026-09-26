import { describe, expect, it } from 'vitest';
import { GENERAL_MIDI_PATCHES } from './patches';

describe('General MIDI patch profile', () => {
  it('maps all 128 program numbers to stable display names', () => {
    expect(GENERAL_MIDI_PATCHES).toHaveLength(128);
    expect(GENERAL_MIDI_PATCHES[0]).toEqual({ name: 'Acoustic Grand Piano', program: 0 });
    expect(GENERAL_MIDI_PATCHES[40]).toEqual({ name: 'Violin', program: 40 });
    expect(GENERAL_MIDI_PATCHES[127]).toEqual({ name: 'Gunshot', program: 127 });
  });
});
