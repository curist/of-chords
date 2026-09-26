# WebChords TODO

This file tracks work intentionally deferred beyond the first playable MVP. It is not a promise to turn WebChords into a DAW.

## Next interaction experiments

- [ ] Compare modifier semantics: snapshot on chord press versus live re-voicing of held chords.
- [ ] Add an optional nearest-voicing strategy while preserving the current deterministic close voicing.
- [ ] Try momentary keyboard bindings for 7th, sus2, sus4, and inversions; keep mappings configurable.
- [ ] Add optional Web MIDI input as another adapter that dispatches instrument actions.
- [ ] Explore an Android/gamepad input adapter without changing the harmony engine.

## Musical range

- [x] Add natural minor as the second mode using the existing scale representation.
- [ ] Decide accidental-spelling policy for flat keys and modal harmony.
- [x] Display half-diminished diatonic sevenths with `ø7` Roman notation.
- [ ] Decide whether suspended degree VII retains its diatonic diminished fifth or uses a perfect fifth.
- [ ] Explore octave/register controls and wider voicings.
- [ ] Consider additional extensions only when an interaction experiment needs them.

## Reliability and usability

- [ ] Perform a visual/interaction pass in Chrome with a real FluidSynth virtual port.
- [ ] Exercise reconnect behavior with multiple real MIDI devices and FluidSynth ports.
- [ ] Add browser-level tests for keyboard, pointer cancellation, visibility, and output switching.
- [ ] Preserve Cmd/Ctrl shortcuts and select typeahead while retaining reliable key-release behavior.
- [ ] Add keyboard activation and explicit ARIA selection state to chord, shape, and inversion controls.
- [ ] Test accessibility with keyboard-only and screen-reader workflows.
- [ ] Consider installable/offline packaging after the interaction model stabilizes.

## Explicit non-goals

- Sequencing, recording, transport, quantization, piano roll, and timeline editing.
- Embedded synthesis, SoundFont management, effects, and sample editing.
- Projects, accounts, authentication, cloud storage, collaboration, and plugin systems.
