# Of Chords MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a playable browser instrument for triggering and inspecting major-key diatonic chords through Web MIDI.

**Architecture:** Pure music functions feed a close-voicing strategy; a typed action/reducer store owns trigger state and emits explicit MIDI effects consumed by a reference-counted MIDI abstraction. Keyboard and DOM adapters translate user gestures into store actions, and store subscribers render snapshots.

**Tech Stack:** TypeScript, Vite, Vitest, browser Web MIDI API, HTML/CSS

**Spec:** `docs/superpowers/specs/2026-09-26-webchords-design.md`

## Global Constraints

- No framework, backend, database, cloud service, audio engine, or embedded synthesizer.
- Input, harmony, voicing, MIDI, state, and UI remain separate.
- Major mode only; all 12 chromatic tonics.
- Multiple simultaneous chord owners and keyboard auto-repeat must be safe.
- Each task follows red-green-refactor and leaves the app runnable.

## Review Focus

- Shared notes survive until every chord owner releases them.
- Repeated keydown for a held key cannot acquire notes twice.
- Blur, hidden-page, panic, and output switching silence owned notes.
- Enharmonic display is readable for every tonic while MIDI pitches remain correct.
- Unsupported or denied Web MIDI leaves the learning UI usable and reports status.

---

### Task 1: Semantic Harmony and Close Voicing

**Files:** Create `src/music/notes.ts`, `src/music/scales.ts`, `src/music/chords.ts`, `src/music/harmony.ts`, `src/music/voicing.ts`, and focused tests under `src/music/`.

**Interfaces:** Produce `resolveChord(intent): AbstractChord`, `voiceChord(chord, register): number[]`, and note-name formatting helpers.

- [x] Write literal-expectation tests for C I, C ii, C V7, G V, C I first inversion, C vii°, suspensions, and all tonic pitch classes.
- [x] Run the tests and confirm they fail because the music modules do not exist.
- [x] Implement the smallest semantic scale/chord pipeline and close voicer.
- [x] Run the focused tests and full suite; refactor only while green.

### Task 2: Reference-Counted MIDI Lifecycle

**Files:** Create `src/midi/note-ledger.ts`, `src/midi/midi-output.ts`, and their tests.

**Interfaces:** Produce `NoteLedger.acquire(owner, notes)`, `release(owner)`, `panic()` and `WebMidiOutputManager` for discovery, selection, status, and MIDI byte output.

- [x] Write tests proving shared-note ownership, duplicate-owner safety, exact release, and panic behavior.
- [x] Run the tests and confirm behavioral failures.
- [x] Implement the ledger, then the thin browser MIDI manager.
- [x] Run focused tests and full suite.

### Task 3: Reducer Store and Configurable Keyboard Input

**Files:** Create `src/state/instrument.ts`, `src/state/store.ts`, `src/input/keyboard.ts`, `src/config.ts`, and focused tests.

**Interfaces:** Produce typed `InstrumentAction`/`InstrumentEffect`, pure `reduceInstrument(state, action)`, and an observable `InstrumentStore.dispatch(action)`; produce `KeyboardInput.attach()` returning a detach function and dispatching actions only.

- [x] Write tests for degree triggering, repeat suppression, simultaneous triggers, modifier snapshot semantics, history, and panic.
- [x] Run the tests and confirm they fail for missing behavior.
- [x] Implement the pure reducer, effect-running store, and configurable keyboard mapping.
- [x] Run focused tests and full suite.

### Task 4: Playable DOM Application

**Files:** Create Vite configuration, `index.html`, `src/main.ts`, `src/ui/app.ts`, `src/styles.css`, and update project documentation.

**Interfaces:** Wire keyboard/pointer/UI gestures into `Instrument`; render chord pads, active harmony, history, MIDI selection/status, and panic.

- [x] Scaffold the minimal TypeScript/Vite entry point and render static controls.
- [x] Wire instrument snapshots and MIDI manager status into idempotent rendering.
- [x] Add defensive blur/visibility handlers and output preference restoration.
- [x] Run the full test suite, typecheck, and production build.

### Task 5: TODO and Usage Documentation

**Files:** Create `README.md` and `docs/TODO.md`.

- [x] Document FluidSynth/browser setup, controls, architecture, and current limitations.
- [x] Record deferred milestones and explicit non-goals in the on-disk TODO.
- [x] Re-run the full verification commands and inspect the final diff.
