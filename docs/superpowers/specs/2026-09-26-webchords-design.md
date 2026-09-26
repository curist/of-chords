# WebChords MVP Design

## Intent

Build a browser instrument for quickly exploring diatonic harmony with the adjacent `A S D F G H J` keys. Success means a player can select a Web MIDI output, hold and combine chord triggers without stuck or prematurely released notes, change tonic and chord modifiers, and understand the harmony from the screen.

## Scope

The MVP supports all 12 tonics in major mode, the seven diatonic degrees, triad/7th/sus2/sus4 chord shapes, root/first/second inversion, a compact recent-chord history, MIDI output selection, and a prominent panic action. Major is the only implemented mode. FluidSynth remains an external MIDI destination.

The app does not include synthesis, recording, sequencing, transport, editing, persistence beyond MIDI-output preference, accounts, or backend services.

## Architecture

Use Vite, TypeScript, vanilla DOM APIs, and Vitest. Keep the boundaries small:

- `music`: pure pitch, scale, chord-intent, and voicing calculations.
- `midi`: Web MIDI discovery/output selection plus a reference-counted note ledger.
- `input`: configurable keyboard-to-degree mapping and repeat-safe key lifecycle.
- `state`: a typed action/reducer store for instrument state, active trigger ownership, modifier snapshots, history, and emitted MIDI effects.
- `ui`: DOM rendering and UI event translation.

The UI and keyboard both dispatch typed actions to the same instrument store. The pure reducer turns `(state, action)` into the next state plus explicit acquire/release/panic effects; a small effect runner applies those effects to MIDI. Subscribers receive immutable snapshots. Neither input adapter resolves harmony nor emits MIDI bytes, and a future gamepad frontend only needs to dispatch the same actions.

## Musical Model and Voicing

A chord intent contains tonic pitch class, mode, scale degree, shape, inversion, and register. The major scale is represented as scale semitone offsets. Diatonic third-stacking derives chord tones rather than storing seven MIDI arrays.

`triad` and `7th` use diatonic thirds. `sus2` and `sus4` replace the third of the triad with a pitch two or five semitones above its root. A close-voicing strategy maps pitch classes around MIDI octave 3/4 and moves the lowest note up an octave for each inversion. Second inversion applies to the lowest three tones; for a seventh chord this produces the conventional second inversion with the seventh remaining above.

Modifier state is sampled when a chord is triggered. Changing a modifier does not mutate already-held chord notes in this iteration. This is explicit so a later live-revoice experiment can be implemented at the controller boundary.

## Note Lifecycle

Every physical/UI trigger gets a stable owner ID. Reducer state remembers the exact notes acquired by each owner and emits an acquire or release effect. The MIDI gateway reference-counts each MIDI note: it emits Note On only for the first owner and Note Off only after the last owner releases it. Repeated keydown events are ignored by state because an already-active owner cannot be acquired again.

Panic, window blur, and a transition to a hidden document release all owners, send explicit Note Off messages for tracked notes, then send MIDI CC 123 (all notes off) and CC 120 (all sound off). Switching MIDI outputs first silences the previous output.

## MIDI and Persistence

Request Web MIDI access on startup, enumerate outputs, and refresh on MIDI state changes. Store the selected output ID in `localStorage` and reconnect when the same ID is available. The page reports unsupported, denied, disconnected, ready, and error states. Raw MIDI messages stay inside the MIDI module.

## UI

The single-page interface shows key and mode controls, seven chord pads with degree/key/name/note spelling, shape and inversion controls, current active chords, recent name and Roman-numeral progressions, MIDI output/status, and panic. Active pads are highlighted and pointer controls support press/hold/release alongside the computer keyboard.

## Testing

Unit tests cover the requested harmony examples, transposition, chord shapes, inversions, shared-note reference counting, repeat-safe triggers, modifier snapshots, and panic. Browser/MIDI plumbing remains thin and is checked by TypeScript compilation and production build.

## Deferred Work

The ordered backlog and interaction experiments live in `docs/TODO.md`.
