# WebChords

An experimental browser instrument for playing and understanding major-key diatonic harmony with seven adjacent keys.

## Run it

Requirements: a Web MIDI-capable browser (Chrome or Edge), Node.js, and an external MIDI destination such as a FluidSynth virtual MIDI port.

```bash
npm install
npm run dev
```

Open the local URL shown by Vite, grant MIDI access, and select the FluidSynth (or other) output. The app only sends MIDI; it does not produce audio itself.

## Controls

- Hold `A S D F G H J` for degrees `I ii iii IV V vi vii°`.
- Choose any chromatic tonic and either Major or Natural minor mode.
- Choose triad, 7th, sus2, or sus4 and root, first, or second inversion.
- Modifier changes apply to the next chord press. Already-held chords retain their notes until released.
- Use **Panic · All Notes Off** if an external device ever sustains unexpectedly.

The app also releases tracked notes on window blur, page hide, and visibility loss. Multiple held chords safely share notes through reference counting.

## Architecture

Inputs dispatch typed actions into a pure reducer/store. The reducer resolves semantic chord intent through the harmony and voicing modules, updates inspectable state, and emits explicit MIDI effects. A note ledger applies those effects to the selected Web MIDI output while preserving shared-note ownership.

```text
keyboard / UI → actions → reducer/store → MIDI effects → note ledger → Web MIDI output
                              ↓
                         UI snapshots
```

Tests focus on harmony, voicing, reducer behavior, input repeat safety, and MIDI note lifecycle. See [`docs/TODO.md`](docs/TODO.md) for deliberately deferred experiments and non-goals.
