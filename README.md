# Of Chords

An experimental browser instrument for playing and understanding diatonic harmony with seven adjacent keys.

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
- Choose any chromatic tonic and Major, Natural minor, Harmonic minor, Dorian, Phrygian, Lydian, Mixolydian, or Locrian mode.
- Choose triad, 7th, sus2, or sus4 and root, first, or second inversion.
- Modifier changes apply to the next chord press. Already-held chords retain their notes until released.
- Use **Panic · All Notes Off** if an external device ever sustains unexpectedly.
- In MIDI mode, choose program 1–128 directly or cycle with wrapping Previous/Next controls and the `[`/`]` keys. No Program Change is sent until you choose one; the choice is resent when the MIDI output changes.
