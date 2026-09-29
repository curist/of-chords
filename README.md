# Of Chords

An experimental browser instrument for playing and understanding diatonic harmony with seven adjacent keys.

## Run it

Requirements: Node.js and a modern browser. Web MIDI input and output require a compatible, secure browser context (such as Chrome or Edge on localhost or HTTPS). MIDI output also needs an external destination such as a hardware synth or FluidSynth virtual MIDI port.

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. The built-in voice works immediately. To play from a MIDI controller, click **Connect input**, grant MIDI access, then choose a device under **MIDI Input**. To use an external sound destination, choose **MIDI** under Sound output, grant access if prompted, and select a **MIDI Output**. You can keep **Built-in** selected while playing from MIDI input.

## Controls

- Hold `A S D F G H J` for degrees `I ii iii IV V vi vii°`.
- On a gamepad, press and release **A** once to activate the controller, then use `A B X Y L1 R1 L2` for degrees `I ii iii IV V vi vii°`. The activation press does not play a chord.
- Choose any chromatic tonic and Major, Natural minor, Harmonic minor, Dorian, Phrygian, Lydian, Mixolydian, or Locrian mode.
- Choose triad, 7th, sus2, or sus4 and root, first, or second inversion.
- Modifier changes apply to the next chord press. Already-held chords retain their notes until released.
- Use **Panic · All Notes Off** if an external device ever sustains unexpectedly.
- In MIDI mode, choose program 1–128 directly or cycle with wrapping Previous/Next controls and the `[`/`]` keys. No Program Change is sent until you choose one; the choice is resent when the MIDI output changes.

## MIDI input

Incoming notes in the selected key and mode play the corresponding diatonic chord, using the current chord shape and inversion. The input note's octave does not change the chord register. Notes outside the scale pass through as single notes at their exact MIDI pitch. Note velocity is carried into the chord or passthrough note, so playing harder changes the MIDI output velocity or built-in voice level. Releasing an input note releases what it started.

The same physical MIDI device may be selected for both **MIDI Input** and **MIDI Output** when it exposes both ports. If it is a keyboard with its own sound engine, you may need to turn **Local Control Off** to avoid hearing its direct key sound alongside the app's output. Check any device MIDI Thru, DAW monitoring, or virtual MIDI routing before sending output back to an input: a feedback loop can rapidly repeat notes. If the app reports a possible MIDI feedback loop, it suspends input and silences output. Correct the routing first, then click **Resume input**. Use **Panic · All Notes Off** if a device still sustains notes.
