# WebChords

An experimental browser instrument for playing and understanding major-key diatonic harmony with seven adjacent keys.

## Run it

Requirements: Node.js and a modern browser. Web MIDI output additionally requires a compatible browser such as Chrome or Edge and an external destination such as a FluidSynth virtual MIDI port.

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. The built-in voice works immediately; optionally select MIDI and grant access to use an external destination.

## Controls

- Hold `A S D F G H J` for degrees `I ii iii IV V vi vii°`.
- On a gamepad, press and release **A** once to activate the controller, then use `A B X Y L1 R1 L2` for degrees `I ii iii IV V vi vii°`. The activation press does not play a chord.
- Choose any chromatic tonic and Major, Natural minor, Dorian, or Mixolydian mode.
- Choose triad, 7th, sus2, or sus4 and root, first, or second inversion.
- Modifier changes apply to the next chord press. Already-held chords retain their notes until released.
- Use **Panic · All Notes Off** if an external device ever sustains unexpectedly.
- In MIDI mode, choose program 1–128 directly or cycle with wrapping Previous/Next controls and the `[`/`]` keys. No Program Change is sent until you choose one; the choice is resent when the MIDI output changes.

The app also releases tracked notes on window blur, page hide, and visibility loss. Multiple held chords safely share notes through reference counting.

## Architecture

Inputs dispatch typed actions into a pure reducer/store. The reducer resolves semantic chord intent through the harmony and voicing modules, updates inspectable state, and emits explicit MIDI effects. A note ledger applies those effects to the selected Web MIDI output while preserving shared-note ownership.

```text
keyboard / gamepad / UI → actions → reducer/store → MIDI effects → note ledger → Web MIDI output
                              ↓
                         UI snapshots
```

Tests focus on harmony, voicing, reducer behavior, input repeat safety, and MIDI note lifecycle. See [`docs/TODO.md`](docs/TODO.md) for deliberately deferred experiments and non-goals.
