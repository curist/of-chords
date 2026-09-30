# Maintainability Refactor Design

## Purpose

Of Chords has strong module-level tests and a clean state/effect core, but recent feature growth has concentrated too many responsibilities in the application UI and composition root. This refactor will remove six identified maintenance risks without changing the instrument's intended behavior:

1. MIDI port changes can clear the built-in synth even when MIDI is not the active output.
2. `App` owns markup, event wiring, four view concerns, and development-only controls.
3. Existing cleanup functions and subscriptions are not retained by the application lifecycle.
4. DOM strings and numbers enter typed application state through unchecked assertions.
5. MIDI input and output managers duplicate persisted-device preference behavior.
6. Render paths repeatedly query stable DOM elements and rely on non-null assertions.

Success means these responsibilities have explicit owners, cleanup is deterministic, invalid DOM values are ignored, and all existing user-visible behavior remains stable except for the MIDI/built-in isolation bug.

## Scope

### In scope

- Make active-output transitions the only output events capable of globally panicking the instrument or resending a MIDI program.
- Preserve MIDI manager device-loss cleanup without allowing inactive MIDI events to silence built-in audio.
- Add deterministic disposal for the application, input adapters, subscriptions, timers, and page listeners.
- Validate values read from `dataset`, selects, and numeric controls before dispatching actions or changing output state.
- Split `App` into focused views with cached, required DOM references.
- Share the persistence mechanics used for preferred MIDI input and output devices.
- Preserve existing HTML structure, CSS selectors, storage keys, status copy, and public behavior unless this design explicitly changes them.
- Keep the runtime dependency set unchanged.

### Out of scope

- Visual redesign or CSS reorganization.
- New MIDI functionality, channels, bank selection, or device profiles.
- Changes to harmony, voicing, note ownership, feedback protection, or synthesizer sound.
- A general UI framework, dependency injection framework, router, or generic component system.
- Merging MIDI input and output into one manager.
- Optimizing rendering beyond caching stable nodes and isolating view updates.

## Architectural Direction

The refactor will be incremental rather than a rewrite. Characterization tests will pin current behavior before each responsibility moves. Every extraction will preserve the existing DOM and manager contracts until the new owner is established.

The target ownership model is:

```text
main / application lifecycle
  |-- creates services and views
  |-- owns cleanup stack
  |-- disposes in reverse construction order
  |
  +-- OutputController
  |     |-- sole authority for active output transitions
  |     +-- built-in sink or MIDI sink
  |
  +-- WebMidiAccess
  |     +-- device discovery and permission state
  |
  +-- WebMidiInputManager ---- PersistedDevicePreference
  +-- WebMidiOutputManager --- PersistedDevicePreference
  |
  +-- App
        |-- InstrumentView
        |-- MidiInputView
        |-- OutputView
        +-- VoiceTuningView (development only)
```

`App` remains the public UI facade used by `main.ts`, but becomes a composition object rather than the implementation of every view. It will render the existing shell, construct the focused views from required elements, connect subscriptions, and dispose those resources.

## Active Output and MIDI Destination Semantics

`OutputController` is the authority for whether the performance engine currently targets the built-in synth or MIDI. Its existing `onWillChange` and `onDidChange` lifecycle callbacks continue to bracket actual active-output mode changes.

MIDI output port changes have two different consequences depending on the active output mode:

- While MIDI is active, replacing or losing the selected port must release ledger ownership before the old destination disappears and resend the selected program after a usable destination appears.
- While the built-in synth is active, MIDI discovery, disconnect, reconnect, and selection changes must not panic the instrument, clear active gestures, stop built-in notes, or resend a program to an inactive MIDI destination.

The composition layer will therefore gate MIDI manager destination callbacks using the current `OutputController.mode`. The callbacks remain on `WebMidiOutputManager` because it alone detects physical port replacement and send failure, but their global store effects apply only when MIDI is active.

Switching from built-in to MIDI still performs the existing sequence: panic the old active sink, select MIDI as active, then resend the current program. Switching back to built-in panics MIDI before changing sinks and does not send a MIDI program afterward.

Tests must cover MIDI disconnect, reconnect, explicit port selection, and send failure in both output modes.

## Application Lifecycle

A focused `CleanupStack` in `src/lifecycle/cleanup-stack.ts` will retain cleanup callbacks as resources are created. It will expose an idempotent `dispose()` operation that invokes callbacks in reverse registration order. `main.ts` will own one stack for the application lifetime; the utility will not manage dependencies or become a general framework.

Cleanup includes:

- keyboard detach;
- gamepad detach and animation-frame cancellation;
- `App.dispose()`, including store and manager subscriptions;
- `GamepadNotification.dispose()`, including its pending dismissal timer;
- MIDI input and output manager disposal;
- window/document listener removal; and
- a final panic before active output resources are detached.

`App.dispose()` will be idempotent. After disposal, snapshots emitted by stores or managers must not mutate its DOM, and user events on the old root must not dispatch actions. Focused views will register their DOM listeners through local cleanup collections rather than anonymous handlers that cannot be removed.

Normal page operation remains a single mount. The lifecycle exists to make ownership correct for tests, development reloads, future remounting, and explicit teardown.

## DOM Boundary Validation

Values crossing from HTML into application state will be parsed instead of asserted. The parsers will be small pure functions located near the domain types they validate, unless they are UI-specific:

- `parsePitchClass(value: string): PitchClass | null` accepts integers `0...11`.
- `parseMode(value: string): Mode | null` accepts keys present in `SCALES`.
- `parseScaleDegree(value: string): ScaleDegree | null` accepts integers `1...7`.
- `parseChordShape(value: string): ChordShape | null` accepts the four supported shapes.
- `parseInversion(value: string): Inversion | null` accepts `0`, `1`, or `2`.
- `parseOutputMode(value: string): OutputMode | null` accepts `builtin` or `midi`.
- voice-parameter updates validate the requested key, control kind, finite numeric value, and waveform before calling `setParams`.

Invalid values are ignored and produce no dispatch, output switch, or synth update. User-facing errors are unnecessary because all values originate from application-owned markup; the validation is a defensive boundary for malformed DOM, stale markup, and tests.

Program entry retains its existing reducer clamping behavior, but empty and non-finite input will not dispatch. The input still blurs after commit.

## UI Decomposition

### Shell and required elements

The current shell markup remains centralized so HTML structure and CSS behavior do not drift during extraction. After the shell is installed, a `requireElement(root, selector)` helper will resolve required nodes once and throw a descriptive initialization error if markup and code disagree. Optional development-only nodes remain explicitly optional.

### `InstrumentView`

Owns tonic and mode selects, shape and inversion controls, chord pads, pointer ownership, currently sounding gestures, recent progression, program controls, and panic. It consumes `InstrumentStore` and renders `InstrumentState`.

It caches its controls and chord-pad sub-elements. It owns pointer event cleanup and clears any local pointer bookkeeping on disposal. Global panic during application disposal remains the authoritative release mechanism.

### `MidiInputView`

Owns the MIDI input selector, connect/resume action, message, and input status pill. It consumes `WebMidiInputManager` snapshots and shared access initialization. It preserves the current distinction between preferred and attached devices.

### `OutputView`

Owns built-in/MIDI mode controls, MIDI output selector, output-specific panel visibility, output message, and output status pill. It consumes `OutputController`, `WebMidiOutputManager`, and shared access initialization.

The MIDI program controls remain in `InstrumentView` because program is instrument state and changes through the reducer, even though their markup appears inside the output panel.

### `VoiceTuningView`

Exists only in development builds. It owns voice controls, reset behavior, validation, and value/readout rendering. Production markup and behavior remain absent as today.

### `App`

Renders the shell, creates the views, owns `GamepadNotification`, and exposes `setGamepadStatus(status)` plus `dispose()`. It does not directly render store or manager snapshots after the extraction.

## Shared MIDI Device Preference

Input and output managers will continue to own their distinct connection state, messages, port attachment, failure recovery, and callbacks. Only the duplicated persistence mechanics will move to a shared helper.

`PersistedDevicePreference` will encapsulate:

- an ID storage key and label storage key supplied at construction;
- safe reads when storage is missing or throws;
- atomic best-effort writes of ID and display label;
- best-effort removal of both values; and
- retrieval of the remembered ID and label.

The helper will preserve these existing keys exactly:

- `webchords.midi-input-id`
- `webchords.midi-input-label`
- `webchords.midi-output-id`
- `webchords.midi-output-label`

Storage remains optional. A failure writing one key must not escape into device management. Managers still determine the meaning of explicit deselection versus physical disconnect: explicit `null` clears the preference; disconnect retains it for reconnection.

The shared helper will not know about ports, snapshots, access status, or reconnection.

## Data and Event Flow

On startup:

1. The composition root creates access, MIDI managers, output routing, ledger, store, and input adapters.
2. It installs gated destination callbacks using `OutputController.mode`.
3. `App` renders its shell, caches elements, constructs views, and subscribes them to state sources.
4. Keyboard, gamepad, page, and visibility listeners attach and return cleanup callbacks.
5. Permission restoration runs as today.

On a MIDI port transition:

1. `WebMidiAccess` publishes the new port snapshot.
2. `WebMidiOutputManager` resolves the preferred output and emits its snapshot.
3. If its selected physical destination changes, it invokes its lifecycle callbacks.
4. The composition callback consults `OutputController.mode`; it panics/resends only in MIDI mode.
5. `OutputView` renders the new device state regardless of active mode.

On disposal:

1. A final global panic releases owned notes while sinks are still connected.
2. Registered resources detach in reverse construction order.
3. Repeated disposal is a no-op.

## Error Handling

- Browser API failures continue to be contained by the existing MIDI and audio adapters.
- Storage errors remain silent because preference persistence is optional.
- Invalid DOM values produce no state change.
- Missing required shell elements fail immediately with a selector-specific error during view construction.
- Listener disposal is idempotent. `CleanupStack` catches individual cleanup failures and continues through every remaining callback so page teardown cannot leave later resources attached.
- Manager listener behavior remains isolated so one throwing subscriber cannot prevent other subscribers from receiving access snapshots.

## File Organization

The expected structure is:

```text
src/
  lifecycle/
    cleanup-stack.ts
    cleanup-stack.test.ts
    page-lifecycle.ts
    page-lifecycle.test.ts
  midi/
    device-preference.ts
    device-preference.test.ts
    midi-input.ts
    midi-input.test.ts
    midi-output.ts
    midi-output.test.ts
  music/
    chords.ts
    notes.ts
    scales.ts
  output/
    output-controller.ts
    output-controller.test.ts
  ui/
    app.ts
    app.test.ts
    dom.ts
    dom.test.ts
    instrument-view.ts
    instrument-view.test.ts
    midi-input-view.ts
    midi-input-view.test.ts
    output-view.ts
    output-view.test.ts
    voice-tuning-view.ts
    voice-tuning-view.test.ts
  main.ts
```

Each focused view receives its own test file. `app.test.ts` retains only shell composition, facade delegation, and whole-App disposal coverage; behavior-specific cases move with their owning view.

## Implementation Sequence

The work will proceed in independently reviewable stages:

1. Add active-mode gating and regression tests for MIDI destination transitions.
2. Add lifecycle cleanup infrastructure and wire deterministic disposal through the existing architecture.
3. Add pure DOM/domain parsers and replace unchecked event-boundary assertions.
4. Extract and test the persisted MIDI device preference helper.
5. Introduce required-element caching and extract focused views one at a time.
6. Reduce `App` to composition, finish lifecycle integration, and run full regression verification.

This order fixes the behavioral defect first, establishes cleanup before objects multiply, and lowers risk by introducing validated boundaries and shared utilities before the largest file split.

## Testing Strategy

All behavior changes use test-driven implementation. Existing tests remain characterization coverage and move only when responsibility moves.

Required regression coverage includes:

- MIDI disconnect/reconnect, port selection, and send failure do not panic or resend while built-in output is active.
- The same MIDI events do panic/resend while MIDI output is active.
- Switching active output retains the existing panic-before-change and program-after-change order.
- Every registered listener, subscription, timer, and animation frame is released exactly once on disposal.
- Disposed views no longer react to source snapshots or DOM events.
- Every parser accepts all valid enum/range values and rejects empty, malformed, fractional, out-of-range, and unknown values.
- Invalid controls cause no dispatch and no synth/output mutation.
- Input and output preference keys and reconnect semantics remain unchanged with working, missing, and throwing storage.
- Each extracted view renders the same snapshots and dispatches the same actions as the current `App`.
- Required-element lookup reports useful failures for markup drift.

Each stage runs its focused Vitest files and `npm run typecheck`. Final verification runs:

```bash
npm test
npm run typecheck
npm run build
```

## Acceptance Criteria

- MIDI output events cannot interrupt built-in playback while built-in mode is active.
- Active MIDI destination changes still prevent stuck notes and restore the selected program.
- `App` is a small composition facade whose focused child views own rendering and DOM events.
- Stable DOM elements are resolved once per view, without repeated render-time lookup or routine non-null assertions.
- No unchecked assertion converts a DOM-provided mode, degree, chord shape, inversion, output mode, voice parameter key, waveform, or numeric value into a domain type.
- MIDI input and output managers use one tested preference helper while retaining separate connection logic.
- Application teardown is explicit, complete, and idempotent.
- Existing storage keys, visual structure, copy, musical behavior, and device reconnect behavior remain unchanged.
- No runtime dependency is added.
- The full test suite, typecheck, and production build pass.
