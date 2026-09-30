# Maintainability Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the six identified maintenance risks while preserving Of Chords behavior, except that inactive MIDI device events must no longer interrupt built-in playback.

**Architecture:** Keep the existing state/effect and browser-adapter design, but make output lifecycle policy explicit, give all mounted resources deterministic cleanup, validate DOM values at their boundary, and split `App` into focused cached-element views. Share only MIDI preference persistence; input and output connection state remain separate.

**Tech Stack:** TypeScript 5.9, Vite 7, Vitest 3, happy-dom, Web Audio, Web MIDI

**Spec:** `docs/superpowers/specs/2026-09-30-maintainability-refactor-design.md`

## Global Constraints

- Preserve existing HTML structure, CSS selectors, storage keys, status copy, musical behavior, and device reconnect behavior unless the spec explicitly changes them.
- Keep the runtime dependency set unchanged.
- Do not merge MIDI input and output managers or introduce a UI, dependency-injection, routing, or component framework.
- Invalid DOM-provided values produce no dispatch, output switch, or synth update.
- Cleanup and disposal operations are idempotent and continue after an individual cleanup callback throws.
- Use characterization tests before moving existing behavior; implement every behavioral change test-first.
- At the end of every task, run its focused tests and `npm run typecheck` before committing.

## Review Focus

- A queued MIDI `didChange` microtask that fires after output mode changed back to built-in must not resend a program; Task 1 adds this race test.
- Disposing during an active gamepad poll or notification timeout must cancel the scheduled callback and release held ownership exactly once; Tasks 2 and 7 cover both schedulers.
- DOM parsing must reject `NaN`, infinities, fractional integers, whitespace-only strings, prototype-looking mode keys, and unknown voice keys without mutation; Task 3 pins these inputs.
- A storage implementation that succeeds for the ID write but throws for the label write must not crash, and explicit deselection must still attempt both removals; Task 4 covers partial storage failure.
- A pointer captured by a chord pad when its view is disposed must not dispatch from a later pointer event, and final application panic must release the note; Tasks 6 and 7 cover this teardown boundary.

---

### Task 1: Active Output Lifecycle Isolation

**Files:**
- Create: `src/output/destination-lifecycle.ts`
- Create: `src/output/destination-lifecycle.test.ts`
- Modify: `src/output/output-controller.ts`
- Modify: `src/output/output-controller.test.ts`
- Modify: `src/midi/midi-output.ts`
- Modify: `src/midi/midi-output.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `type Unsubscribe = () => void` as the return contract of `OutputController.onWillChange(listener)`, `OutputController.onDidChange(listener)`, `WebMidiOutputManager.onDestinationWillChange(listener)`, and `WebMidiOutputManager.onDestinationDidChange(listener)`.
- Produces: `bindDestinationLifecycle(output, midi, dispatch): () => void` in `destination-lifecycle.ts`; `output` exposes `mode`, `onWillChange`, and `onDidChange`, `midi` exposes both destination registration methods, and `dispatch` consumes `InstrumentAction`.
- Behavior: every actual output-mode transition dispatches `panic` before the change, but output `didChange` dispatches `resend-program` only when the new/current mode is `midi`. MIDI-port transitions dispatch their matching action only when `output.mode === 'midi'` at callback execution time.

- [ ] **Step 1: Write failing destination-policy tests**

In `src/output/destination-lifecycle.test.ts`, use callback-capturing fakes and assert `bindDestinationLifecycle`:

- dispatches `panic` for output `willChange` in either direction;
- dispatches `resend-program` for output `didChange` only when the new/current mode is `midi`, never after switching to built-in;
- ignores MIDI `willChange` and `didChange` while mode is `builtin`;
- dispatches the matching actions while mode is `midi`;
- consults the current mode when a captured/queued callback executes, so a callback registered in MIDI mode but fired after returning to built-in does nothing; and
- returns an idempotent cleanup that unregisters all four callbacks.

- [ ] **Step 2: Run the destination-policy tests and verify failure**

Run: `npm test -- src/output/destination-lifecycle.test.ts`

Expected: FAIL because `bindDestinationLifecycle` does not exist and lifecycle registrations do not return cleanup callbacks.

- [ ] **Step 3: Make lifecycle registrations independently removable**

Change the four registration methods listed in Interfaces to store listeners in `Set<() => void>` collections and return idempotent unsubscribe functions. Update the existing output-controller and MIDI-output tests to prove two listeners can coexist, removing one leaves the other active, and `dispose()` clears MIDI output listeners plus its access subscription. In `midi-output.test.ts`, explicitly prove callback emission for selected-port replacement, physical disconnect, physical reconnect, and send failure.

- [ ] **Step 4: Run manager tests and verify success**

Run: `npm test -- src/output/output-controller.test.ts src/midi/midi-output.test.ts`

Expected: PASS with removable multi-listener lifecycle callbacks.

- [ ] **Step 5: Implement and wire `bindDestinationLifecycle`**

Implement the exact policy in Interfaces. Replace the four unconditional registrations in `src/main.ts` with one call to `bindDestinationLifecycle`; retain its returned cleanup for Task 2's cleanup stack rather than discarding it.

- [ ] **Step 6: Add manager-driven lifecycle integration tests**

In `destination-lifecycle.test.ts`, use a real `OutputController`, `WebMidiOutputManager`, fake MIDI access, and dispatch spy. For each selected-port replacement, physical disconnect, physical reconnect, and send failure, assert no global action in built-in mode and the appropriate `panic`/`resend-program` action in MIDI mode. For asynchronous `didChange`, switch back to built-in before flushing the microtask and assert no resend occurs.

- [ ] **Step 7: Run Task 1 verification**

Run: `npm test -- src/output/destination-lifecycle.test.ts src/output/output-controller.test.ts src/midi/midi-output.test.ts && npm run typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/output/destination-lifecycle.ts src/output/destination-lifecycle.test.ts src/output/output-controller.ts src/output/output-controller.test.ts src/midi/midi-output.ts src/midi/midi-output.test.ts src/main.ts
git commit -m "fix: isolate inactive MIDI destination changes"
```

### Task 2: Deterministic Application Cleanup

**Files:**
- Create: `src/lifecycle/cleanup-stack.ts`
- Create: `src/lifecycle/cleanup-stack.test.ts`
- Create: `src/lifecycle/application-disposer.ts`
- Create: `src/lifecycle/application-disposer.test.ts`
- Modify: `src/lifecycle/page-lifecycle.ts`
- Modify: `src/lifecycle/page-lifecycle.test.ts`
- Modify: `src/input/keyboard.test.ts`
- Modify: `src/input/gamepad.test.ts`
- Modify: `src/ui/app.ts`
- Modify: `src/ui/app.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `type Cleanup = () => void` and class `CleanupStack` with `add(cleanup: Cleanup): Cleanup`, `dispose(): void`, and `disposed: boolean`.
- `add` returns the same cleanup for convenient registration, invokes a cleanup immediately when added after disposal, and never invokes any cleanup more than once.
- `dispose` marks the stack disposed before invoking callbacks, runs them in reverse registration order, catches individual failures, and continues.
- Produces: `createApplicationDisposer(resources: CleanupStack, panic: Cleanup): Cleanup`; the returned idempotent function invokes `panic` exactly once before `resources.dispose()` and still disposes resources if panic throws.
- Produces: `App.dispose(): void`, initially responsible for current source subscriptions, root DOM listeners, and `GamepadNotification` timer cleanup; later view tasks transfer ownership behind the same method.
- Changes: `handlePageHide(event, dispose, panic)` calls `panic()` without disposal when `event.persisted === true`; otherwise it calls the application disposer, which performs its one final panic before starting reverse-order resource cleanup.

- [ ] **Step 1: Write failing `CleanupStack` tests**

In `src/lifecycle/cleanup-stack.test.ts`, assert reverse order, idempotence, continuation after a throwing callback, immediate one-time invocation for cleanup added after disposal, and accurate `disposed` state.

- [ ] **Step 2: Run cleanup-stack tests and verify failure**

Run: `npm test -- src/lifecycle/cleanup-stack.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `CleanupStack`**

Implement the interface above without dependencies. Do not aggregate or rethrow cleanup errors.

- [ ] **Step 4: Write the failing application-disposer integration tests**

In `application-disposer.test.ts`, register named App, input, manager, destination-binding, DOM-listener, and scheduler cleanups in a `CleanupStack`. Assert the returned disposer records `panic` first, then every resource in reverse registration order, exactly once. Assert a throwing panic still runs all resources and a throwing resource does not stop later cleanup.

- [ ] **Step 5: Implement `createApplicationDisposer`**

Implement the exact interface above. Track invocation separately from `CleanupStack` so repeated disposal cannot panic again.

- [ ] **Step 6: Add failing lifecycle and App disposal tests**

Update `page-lifecycle.test.ts` for the new whole-application disposer contract. In `app.test.ts`, make fixture subscriptions return spies and assert `App.dispose()` unsubscribes each source exactly once, cancels a pending gamepad-notification timeout, removes root event behavior, and ignores repeated disposal. Extend keyboard/gamepad tests to assert their existing detach callbacks are idempotent; gamepad detach must cancel the active frame and release each held owner once.

- [ ] **Step 7: Run lifecycle tests and verify failure**

Run: `npm test -- src/lifecycle/cleanup-stack.test.ts src/lifecycle/application-disposer.test.ts src/lifecycle/page-lifecycle.test.ts src/ui/app.test.ts src/input/keyboard.test.ts src/input/gamepad.test.ts`

Expected: FAIL until App and adapter detach paths are idempotent and retained.

- [ ] **Step 8: Wire deterministic teardown through the current architecture**

Use a private `CleanupStack` inside `App` to retain subscriptions, root event removals, and `GamepadNotification.dispose()`. Make keyboard and gamepad detach closures idempotent. In `main.ts`, create a resource `CleanupStack`, register destination lifecycle cleanup from Task 1, `App.dispose`, manager disposal, input detach callbacks, and explicit window/document listener removals. Create the one application disposer with `createApplicationDisposer(resources, panic)` and pass it to `handlePageHide`; if `import.meta.hot` is available, register the same disposer with `import.meta.hot.dispose`.

- [ ] **Step 9: Run Task 2 verification**

Run: `npm test -- src/lifecycle/cleanup-stack.test.ts src/lifecycle/application-disposer.test.ts src/lifecycle/page-lifecycle.test.ts src/ui/app.test.ts src/input/keyboard.test.ts src/input/gamepad.test.ts && npm run typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 10: Commit Task 2**

```bash
git add src/lifecycle/cleanup-stack.ts src/lifecycle/cleanup-stack.test.ts src/lifecycle/application-disposer.ts src/lifecycle/application-disposer.test.ts src/lifecycle/page-lifecycle.ts src/lifecycle/page-lifecycle.test.ts src/input/keyboard.test.ts src/input/gamepad.test.ts src/ui/app.ts src/ui/app.test.ts src/main.ts
git commit -m "refactor: add deterministic application cleanup"
```

### Task 3: Typed DOM Boundaries

**Files:**
- Create: `src/ui/dom.ts`
- Create: `src/ui/dom.test.ts`
- Modify: `src/music/chords.ts`
- Modify: `src/music/harmony.test.ts`
- Modify: `src/music/notes.ts`
- Modify: `src/music/scales.ts`
- Modify: `src/audio/voice-params.ts`
- Modify: `src/ui/app.ts`
- Modify: `src/ui/app.test.ts`

**Interfaces:**
- Produces: `parsePitchClass(value: string): PitchClass | null` in `notes.ts`.
- Produces: `parseMode(value: string): Mode | null` in `scales.ts`.
- Produces: `parseScaleDegree(value: string): ScaleDegree | null`, `parseChordShape(value: string): ChordShape | null`, and `parseInversion(value: string): Inversion | null` in `chords.ts`.
- Produces: `parseOutputMode(value: string): OutputMode | null` and `requireElement<T extends Element>(root: ParentNode, selector: string): T` in `ui/dom.ts`.
- Produces: `parseVoiceParam(key: string, value: string): Partial<VoiceParams> | null` in `voice-params.ts`, validating the declared range kind, finite numeric value within its configured min/max, and members of `WAVEFORMS`.
- Changes: `commitTonicSelection`, `commitModeSelection`, and `commitProgramSelection` retain their `void` return contract; program commit always blurs and rejects empty/non-finite values.

- [ ] **Step 1: Write failing parser tests**

Add table-driven tests covering every valid domain member plus rejection of empty strings, whitespace, fractional integers, `NaN`, `Infinity`, out-of-range numbers, unknown enum strings, `__proto__`, unknown voice keys, waveform values on numeric keys, numeric values on waveform keys, and numeric voice values outside configured ranges. Assert `requireElement` returns a matching typed element and throws an error containing the missing selector.

- [ ] **Step 2: Run parser tests and verify failure**

Run: `npm test -- src/ui/dom.test.ts src/music/harmony.test.ts src/ui/app.test.ts`

Expected: FAIL because the parsers and required-element helper do not exist and commit helpers still assert types.

- [ ] **Step 3: Implement pure parsers and required-element lookup**

Implement the signatures in Interfaces. Integer parsers must require `value.trim() !== ''`, `Number.isInteger(Number(value))`, and the specified closed range. `parseMode` must use an own-property check against `SCALES`. `parseVoiceParam` must look up `VOICE_PARAM_RANGES` by exact key and return one-property partial objects only for valid values.

- [ ] **Step 4: Replace event-boundary assertions in the current `App`**

Use the new parsers for tonic, mode, shape, inversion, chord degree, output mode, program entry, and voice parameters. Invalid values return without dispatch or mutation. Use `requireElement` after shell rendering for required nodes touched during initialization; broader caching occurs during view extraction.

- [ ] **Step 5: Add DOM-event regression tests**

In `app.test.ts`, mutate each relevant `value` or `dataset` to one invalid representative and dispatch its real event. Assert no store dispatch, output mode change, access initialization, or synth parameter change occurs. Assert valid values retain current behavior and program input always blurs.

- [ ] **Step 6: Run Task 3 verification**

Run: `npm test -- src/ui/dom.test.ts src/music/harmony.test.ts src/ui/app.test.ts && npm run typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/ui/dom.ts src/ui/dom.test.ts src/music/chords.ts src/music/harmony.test.ts src/music/notes.ts src/music/scales.ts src/audio/voice-params.ts src/ui/app.ts src/ui/app.test.ts
git commit -m "refactor: validate DOM values at boundaries"
```

### Task 4: Shared MIDI Device Preferences

**Files:**
- Create: `src/midi/device-preference.ts`
- Create: `src/midi/device-preference.test.ts`
- Modify: `src/midi/storage.ts`
- Modify: `src/midi/midi-input.ts`
- Modify: `src/midi/midi-input.test.ts`
- Modify: `src/midi/midi-output.ts`
- Modify: `src/midi/midi-output.test.ts`

**Interfaces:**
- Produces: `class PersistedDevicePreference` constructed as `(storage: StorageLike | null, idKey: string, labelKey: string)`.
- Produces: `id(): string | null`, `label(): string | null`, `set(id: string, label: string): void`, and `clear(): void`.
- `set` and `clear` attempt both key operations independently even if the first throws; no storage error escapes.
- Consumes: existing `StorageLike` and `getOptionalStorage` from `midi/storage.ts`.
- Preserves: the four exact `webchords.midi-{input,output}-{id,label}` keys and explicit-clear versus physical-disconnect semantics.

- [ ] **Step 1: Write failing preference-helper tests**

Assert successful read/write/clear, null storage, throwing reads, throwing writes, and throwing removals. Include partial failures where the ID operation throws but the label operation is still attempted and vice versa.

- [ ] **Step 2: Run helper tests and verify failure**

Run: `npm test -- src/midi/device-preference.test.ts`

Expected: FAIL because `PersistedDevicePreference` does not exist.

- [ ] **Step 3: Implement `PersistedDevicePreference`**

Implement the exact interface without port or connection knowledge. Keep `StorageLike` and `getOptionalStorage` exported from `storage.ts`; stop re-exporting them through `midi-output.ts` and update imports accordingly.

- [ ] **Step 4: Add failing manager characterization assertions**

Before changing manager code, add assertions that physical disconnect keeps both stored values, explicit `selectInput(null)`/`selectOutput(null)` attempts to clear both, and partial storage failures never prevent snapshot emission or selection changes.

- [ ] **Step 5: Run the manager characterization tests and verify the new boundary failures**

Run: `npm test -- src/midi/midi-input.test.ts src/midi/midi-output.test.ts`

Expected: existing reconnect/deselect cases PASS; new independent-operation partial-failure cases FAIL because each manager currently groups both storage operations in one `try` block.

- [ ] **Step 6: Refactor the MIDI managers to use the helper**

Construct one preference helper per manager with its existing exact keys. Replace local `#storageGet`, `#storageSet`, and `#storageRemove` methods. Preserve preferred ID/label snapshots, reconnect behavior, explicit deselection, send-failure recovery, and every current status message.

- [ ] **Step 7: Run Task 4 verification**

Run: `npm test -- src/midi/device-preference.test.ts src/midi/midi-input.test.ts src/midi/midi-output.test.ts && npm run typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/midi/device-preference.ts src/midi/device-preference.test.ts src/midi/storage.ts src/midi/midi-input.ts src/midi/midi-input.test.ts src/midi/midi-output.ts src/midi/midi-output.test.ts
git commit -m "refactor: share MIDI device preferences"
```

### Task 5: Extract MIDI Input and Output Views

**Files:**
- Create: `src/ui/midi-input-view.ts`
- Create: `src/ui/midi-input-view.test.ts`
- Create: `src/ui/output-view.ts`
- Create: `src/ui/output-view.test.ts`
- Modify: `src/ui/app.ts`
- Modify: `src/ui/app.test.ts`

**Interfaces:**
- Produces: `class MidiInputView` constructed with `(root, midiInput, midiAccess)` and exposing `dispose(): void`; it owns the input selector, action button, message, status pill, DOM events, and MIDI-input subscription.
- Produces: `class OutputView` constructed with `(root, output, midi, midiAccess)` and exposing `dispose(): void`; it owns output-mode buttons, output panels, MIDI output selector, message, status pill, DOM events, and output/MIDI subscriptions.
- Both constructors resolve and cache required nodes once with `requireElement`; render methods perform no `querySelector` calls.
- Consumes: Task 2 cleanup stack and Task 3 parsers.

- [ ] **Step 1: Move MIDI input characterization cases into a failing focused fixture**

Create `midi-input-view.test.ts` by moving the existing connected, disconnected, requesting, suspended, selection, connect, and resume cases from `app.test.ts`. Add disposal assertions: source emissions and DOM events after disposal have no effect, and repeated disposal unsubscribes once.

- [ ] **Step 2: Run the MIDI input view tests and verify failure**

Run: `npm test -- src/ui/midi-input-view.test.ts`

Expected: FAIL because `MidiInputView` does not exist.

- [ ] **Step 3: Implement `MidiInputView` and delegate from `App`**

Move only MIDI-input behavior from `App`; keep shell markup in `App`. Cache all required elements in constructor fields and retain listener/subscription cleanup. Delete moved helpers and cases from `app.ts`/`app.test.ts` after focused tests pass.

- [ ] **Step 4: Run MIDI input view tests**

Run: `npm test -- src/ui/midi-input-view.test.ts src/ui/app.test.ts`

Expected: PASS with unchanged input UI behavior.

- [ ] **Step 5: Move output characterization cases into a failing focused fixture**

Create `output-view.test.ts` covering mode activation ordering, built-in versus MIDI panel visibility, output option rendering including disconnected preference, status text/pill state, no invalid-mode activation, and disposal behavior. Assert cached rendering by removing a required element after construction and showing snapshot updates still target the cached node without another lookup.

- [ ] **Step 6: Run the output view tests and verify failure**

Run: `npm test -- src/ui/output-view.test.ts`

Expected: FAIL because `OutputView` does not exist.

- [ ] **Step 7: Implement `OutputView` and delegate from `App`**

Move only output-mode/MIDI-output behavior from `App`. Keep MIDI program controls out of this view. Cache nodes, retain cleanup, and preserve current copy and option labels.

- [ ] **Step 8: Run Task 5 verification**

Run: `npm test -- src/ui/midi-input-view.test.ts src/ui/output-view.test.ts src/ui/app.test.ts && npm run typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 9: Commit Task 5**

```bash
git add src/ui/midi-input-view.ts src/ui/midi-input-view.test.ts src/ui/output-view.ts src/ui/output-view.test.ts src/ui/app.ts src/ui/app.test.ts
git commit -m "refactor: extract MIDI interface views"
```

### Task 6: Extract the Instrument View

**Files:**
- Create: `src/ui/instrument-view.ts`
- Create: `src/ui/instrument-view.test.ts`
- Modify: `src/ui/app.ts`
- Modify: `src/ui/app.test.ts`

**Interfaces:**
- Produces: `class InstrumentView` constructed with `(root: HTMLElement, store: InstrumentStore)` and exposing `dispose(): void`.
- Owns: tonic/mode selects, shape/inversion controls, chord pads and their cached child nodes, pointer ownership, currently sounding readout, history, panic, and MIDI program controls.
- Consumes: Task 2 cleanup stack, Task 3 parsers and `requireElement`, existing harmony/voicing functions, and `InstrumentStore`.
- Behavior: all stable elements and chord-pad children are cached once; `render(state)` performs no DOM query.

- [ ] **Step 1: Create focused instrument-view characterization tests**

Move tonic, mode, select-blur, program, chord-pad rendering, active gestures, history, shape/inversion, pointer press/release/cancel, and panic cases from `app.test.ts`. Add cases for multiple simultaneous pointer IDs and invalid dataset values. Assert a pointerdown followed by `dispose()` and a later pointerup dispatches no release from the disposed view; the application-level panic in Task 7 remains responsible for releasing active sound.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- src/ui/instrument-view.test.ts`

Expected: FAIL because `InstrumentView` does not exist.

- [ ] **Step 3: Implement cached chord-pad and instrument elements**

Define a private cached pad record containing its button, Roman, name, and note elements plus parsed degree. Resolve every required element during construction and bind events through the view cleanup stack. Move `#renderInstrument` and `#renderGesture` behavior without changing output markup or copy.

- [ ] **Step 4: Delegate instrument behavior from `App`**

Construct `InstrumentView` after shell rendering, register its disposer with `App`, and delete the moved state, listeners, render methods, helpers, imports, and tests from `app.ts`/`app.test.ts`.

- [ ] **Step 5: Run Task 6 verification**

Run: `npm test -- src/ui/instrument-view.test.ts src/ui/app.test.ts src/state/instrument.test.ts && npm run typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/ui/instrument-view.ts src/ui/instrument-view.test.ts src/ui/app.ts src/ui/app.test.ts
git commit -m "refactor: extract instrument view"
```

### Task 7: Extract Voice Tuning and Finish App Composition

**Files:**
- Create: `src/ui/voice-tuning-view.ts`
- Create: `src/ui/voice-tuning-view.test.ts`
- Modify: `src/ui/app.ts`
- Modify: `src/ui/app.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `class VoiceTuningView` constructed with `(root: HTMLElement, synth: WebAudioSynthSink)` and exposing `setOutputMode(mode: OutputMode): void` and `dispose(): void`.
- Owns: development-only voice inputs, reset action, cached readouts, validated synth updates, and built-in-only visibility.
- Final `App` owns only shell rendering, child-view construction/disposal, `GamepadNotification`, `setGamepadStatus(status)`, and `dispose()`.
- `GamepadNotification.dispose(): void` cancels a pending timeout, hides the notification, and is idempotent; updates after disposal do nothing.

- [ ] **Step 1: Write focused voice-tuning and notification lifecycle tests**

Move voice control/reset/readout cases into `voice-tuning-view.test.ts`; assert invalid keys/values do not call `setParams`, output mode changes visibility, and disposal removes behavior. In `app.test.ts`, add fake-timer coverage proving `GamepadNotification.dispose()` cancels the ready-dismiss timeout, ignores later updates, and is idempotent.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- src/ui/voice-tuning-view.test.ts src/ui/app.test.ts`

Expected: FAIL because the focused view and notification disposal behavior do not exist.

- [ ] **Step 3: Implement `VoiceTuningView`**

Cache controls/readouts by iterating `VOICE_PARAM_RANGES` once. Use `parseVoiceParam` for input. Preserve dev-only construction, default reset, displayed decimals/units, and visibility tied to output mode.

- [ ] **Step 4: Reduce `App` to the composition facade**

Keep shell markup generation in `App`; construct `InstrumentView`, `MidiInputView`, `OutputView`, and optional `VoiceTuningView`, registering each disposer. Connect output snapshots to `VoiceTuningView.setOutputMode` through one retained subscription. Implement final `GamepadNotification.dispose()` and remove all behavior-specific rendering/query code from `App`.

- [ ] **Step 5: Add final composition and teardown tests**

In `app.test.ts`, assert the full shell still has the same major sections and selectors, App constructs successfully in development-test mode, `setGamepadStatus` delegates, and `dispose()` tears down child behavior exactly once. In `page-lifecycle.test.ts`, assert non-persisted page hide invokes application disposal without a separate panic, while persisted page hide panics without disposing. The application-disposer integration test from Task 2 proves disposal itself panics first.

- [ ] **Step 6: Run the full verification suite**

Run: `npm test && npm run typecheck && npm run build`

Expected: all tests PASS, TypeScript exits 0, and Vite produces a successful production build.

- [ ] **Step 7: Verify the production build excludes development voice tuning**

Run: `if rg -n "Voice tuning|Development.*Voice tuning" dist/assets; then exit 1; fi`

Expected: exit 0 with no matches, proving the development-only markup/copy was removed by the production build.

- [ ] **Step 8: Inspect the final responsibility boundaries**

Run: `wc -l src/ui/app.ts src/ui/*-view.ts && rg -n "querySelector|querySelectorAll| as (Mode|OutputMode|ScaleDegree|ChordShape|Inversion)|!\." src/ui --glob '*.ts' --glob '!*.test.ts'`

Expected: `app.ts` contains composition/shell concerns only; render methods in focused views contain no DOM queries; no unchecked DOM-to-domain assertions remain. Any remaining non-null assertion must be unrelated to required cached markup and documented in the task review.

- [ ] **Step 9: Commit Task 7**

```bash
git add src/ui/voice-tuning-view.ts src/ui/voice-tuning-view.test.ts src/ui/app.ts src/ui/app.test.ts src/main.ts src/lifecycle/page-lifecycle.test.ts
git commit -m "refactor: finish focused UI composition"
```
