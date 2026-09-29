# MIDI Input Harmonizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable MIDI input that turns in-scale notes into diatonic chords, passes other notes through unchanged, preserves velocity, and safely supports using one device for both input and output.

**Architecture:** A shared Web MIDI access service owns browser permission and port discovery. Focused input and output adapters consume it independently, while every performed gesture continues through the reducer, output controller, and reference-counted note ledger. Instrument state remains authoritative for active ownership; the MIDI input adapter tracks only cleanup candidates and protects the app with a deterministic event-burst circuit breaker.

**Tech Stack:** TypeScript 5.9, Web MIDI API, Web Audio API, Vite 7, Vitest 3, browser DOM APIs.

**Spec:** `docs/superpowers/specs/2026-09-29-midi-input-harmonizer-design.md`

## Global Constraints

- Accept Note On and Note Off on all 16 input channels; keep MIDI output on channel 1.
- Treat Note On with velocity zero as Note Off; ignore all other MIDI message classes in this release.
- Map pitch classes enharmonically against the current tonic and mode; input octave does not change chord voicing.
- Pass an out-of-scale input through at its exact MIDI note number.
- Snapshot mapping, shape, inversion, voiced notes, and velocity at Note On; later setting changes do not mutate held gestures.
- Propagate velocity `1...127`; existing non-MIDI inputs retain default velocity 100.
- Preserve ledger reference counting: shared notes receive only the first Note On and final Note Off, without velocity replacement or retrigger.
- Permit independent input and output ports belonging to the same physical device.
- Permit 64 Note Ons per rolling 100 ms and reject the 65th before dispatch while suspending input and panicking output.
- Require an explicit Resume input action after feedback suspension; automatic reconnect must not resume it.
- Add no runtime dependency and no device-specific MIDI profile.

## Review Focus

- A scale or mode change while a MIDI key is held must not change what its Note Off releases; Task 1 pins the snapshot behavior.
- Global panic followed by another Note On for the same port/channel/note must sound again; Task 3 proves adapter cleanup tracking is not ownership authority.
- Physical disconnect must retain the preferred input ID, while explicit No input must erase it; Task 3 tests both paths.
- A failed MIDI permission request must allow a later explicit retry, and disposing one adapter must not disrupt the other; Task 2 tests shared-service isolation.
- Feedback detection must allow event 64, reject event 65, remain suspended across reconnect, and resume only through the explicit action; Tasks 3 and 4 cover adapter and DOM paths.

---

### Task 1: Musical Mapping, Literal Gestures, and Velocity

**Files:**
- Modify: `src/music/scales.ts`
- Modify: `src/music/harmony.test.ts`
- Modify: `src/state/instrument.ts`
- Modify: `src/state/instrument.test.ts`
- Modify: `src/state/store.ts`
- Modify: `src/midi/note-ledger.ts`
- Modify: `src/midi/note-ledger.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `scaleDegreeForPitchClass(tonic: PitchClass, mode: Mode, pitchClass: PitchClass): ScaleDegree | null`.
- Produces: `InstrumentAction` variants `{ type: 'press'; owner: string; degree: ScaleDegree; velocity?: number }` and `{ type: 'press-note'; owner: string; note: number; velocity: number }`.
- Produces: `ActiveGesture = ActiveChord | ActiveLiteralNote`, discriminated by `kind: 'chord' | 'literal'`; `InstrumentState.active` stores `Record<string, ActiveGesture>` while `history` remains `ActiveChord[]`.
- Produces: acquire effect `{ type: 'acquire'; owner: string; notes: readonly number[]; velocity: number }`.
- Produces: `NoteLedger.acquire(owner: string, notes: readonly number[], velocity?: number): void`, defaulting to velocity 100.
- Consumes: existing `NoteSink.noteOn(note: number, velocity?: number)` and current chord resolver/voicer.

- [ ] **Step 1: Add failing scale-degree mapping tests**

Add table-driven cases to `src/music/harmony.test.ts` proving C major maps C/D/E/F/G/A/B to degrees 1–7, D major maps D/E/F♯/G/A/B/C♯ to 1–7, notes are octave-independent after pitch-class normalization, and C natural minor returns `null` for F♯.

- [ ] **Step 2: Run the mapping tests and verify failure**

Run: `npm test -- src/music/harmony.test.ts`

Expected: FAIL because `scaleDegreeForPitchClass` is not exported.

- [ ] **Step 3: Implement the pure scale lookup**

Add `scaleDegreeForPitchClass(...)` to `src/music/scales.ts`. Generate the seven normalized scale pitch classes from `SCALES[mode].intervals`, return the one-based index as `ScaleDegree`, and return `null` when absent.

- [ ] **Step 4: Run the mapping tests and verify success**

Run: `npm test -- src/music/harmony.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing reducer tests for velocity and literal-note snapshots**

In `src/state/instrument.test.ts`, assert:

- a degree press at velocity 37 emits one acquire effect whose velocity is 37 and records a `kind: 'chord'` active gesture;
- a degree press without velocity emits velocity 100;
- `press-note` for MIDI note 61 at velocity 73 records `kind: 'literal'`, emits acquire for `[61]`, and does not append to chord history;
- setting tonic/mode/shape/inversion after either press does not alter the notes released by the matching owner;
- duplicate presses for an active owner remain effect-free, while panic followed by the same owner press acquires again.

- [ ] **Step 6: Run reducer tests and verify failure**

Run: `npm test -- src/state/instrument.test.ts`

Expected: FAIL because velocity effects, literal gestures, and the discriminant do not exist.

- [ ] **Step 7: Implement reducer and store contracts**

In `src/state/instrument.ts`, add the exact action, gesture, and effect types from Interfaces. Clamp MIDI-supplied velocity with `Math.trunc` to `1...127`; retain 100 for omitted degree velocity. Literal-note presses clamp the note to integer `0...127`, populate note name/MIDI display data, and never enter `history`. Preserve the resolved notes in each active gesture so release remains owner-based and setting-independent.

Update `src/state/store.ts` to call `target.acquire(effect.owner, effect.notes, effect.velocity)`, and update `InstrumentEffectTarget.acquire` accordingly.

- [ ] **Step 8: Run reducer tests and verify success**

Run: `npm test -- src/state/instrument.test.ts`

Expected: PASS.

- [ ] **Step 9: Add failing ledger velocity tests**

In `src/midi/note-ledger.test.ts`, assert a new note forwards the supplied velocity, omitted velocity forwards 100, a second owner sharing that note emits no second Note On, and after the final release a later acquire uses its new velocity.

- [ ] **Step 10: Run ledger tests and verify failure**

Run: `npm test -- src/midi/note-ledger.test.ts`

Expected: FAIL because `acquire` does not forward velocity.

- [ ] **Step 11: Implement ledger velocity propagation**

Change `NoteLedger.acquire(owner, notes, velocity = 100)` to pass the velocity only when a note's global reference count changes from zero to one. Do not store or replace velocity for shared notes.

Update the `main.ts` effect target to forward its third argument to the ledger.

- [ ] **Step 12: Run Task 1 tests and type checking**

Run: `npm test -- src/music/harmony.test.ts src/state/instrument.test.ts src/midi/note-ledger.test.ts && npm run typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 13: Commit Task 1**

```bash
git add src/music/scales.ts src/music/harmony.test.ts src/state/instrument.ts src/state/instrument.test.ts src/state/store.ts src/midi/note-ledger.ts src/midi/note-ledger.test.ts src/main.ts
git commit -m "feat: add velocity-aware MIDI gestures"
```

### Task 2: Shared Web MIDI Access and Output Refactor

**Files:**
- Create: `src/midi/midi-access.ts`
- Create: `src/midi/midi-access.test.ts`
- Modify: `src/midi/midi-output.ts`
- Modify: `src/midi/midi-output.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `MidiPortInfo { id: string; name: string; manufacturer: string; state: 'connected' | 'disconnected' }`.
- Produces: `MidiAccessSnapshot { status: MidiStatus; message: string; inputs: readonly MidiPortInfo[]; outputs: readonly MidiPortInfo[] }`.
- Produces: `WebMidiAccess.initialize(): Promise<void>`, `restoreIfPermitted(): Promise<void>`, `snapshot()`, `subscribe(listener)`, `findInput(id)`, and `findOutput(id)`.
- Produces: exported structural `MidiInputPortLike`, `MidiOutputPortLike`, and `MidiAccessLike` testable without browser globals.
- Produces: `WebMidiOutputManager(access: WebMidiAccess, storage?: StorageLike | null)`; its existing public snapshot, selection, note, program, and destination-change methods remain stable.
- Consumes: one shared `WebMidiAccess` instance in `src/main.ts`.

- [ ] **Step 1: Write failing shared-access tests**

Create `src/midi/midi-access.test.ts` with fake navigator/access/ports. Assert:

- two concurrent `initialize()` calls make exactly one `requestMIDIAccess()` call;
- a successful access object is reused by later calls;
- rejected initialization reports denied/error, clears the in-flight promise, and a later explicit call retries;
- `restoreIfPermitted()` requests access only for granted permission;
- one `onstatechange` handler refreshes immutable connected input/output snapshots;
- unsubscribing one listener leaves other listeners and port discovery operating.

- [ ] **Step 2: Run shared-access tests and verify failure**

Run: `npm test -- src/midi/midi-access.test.ts`

Expected: FAIL because `midi-access.ts` does not exist.

- [ ] **Step 3: Implement `WebMidiAccess`**

Move browser permission, request, access caching, in-flight deduplication, status, port enumeration, and state-change publication out of the output manager. The service owns its access object's state-change handler for its lifetime; subscriber disposal only removes that subscriber. Clear only failed in-flight promises; retain successful access.

- [ ] **Step 4: Run shared-access tests and verify success**

Run: `npm test -- src/midi/midi-access.test.ts`

Expected: PASS.

- [ ] **Step 5: Adapt output tests to the shared service and add isolation coverage**

Update `src/midi/midi-output.test.ts` to inject a `WebMidiAccess` backed by its fakes. Preserve every existing selection, restoration, output-loss, panic callback, and program test. Add a test that disposing an unrelated access subscription does not break output sends or output state refresh.

- [ ] **Step 6: Run output tests and verify failure**

Run: `npm test -- src/midi/midi-output.test.ts`

Expected: FAIL until the output manager constructor and discovery logic use `WebMidiAccess`.

- [ ] **Step 7: Refactor `WebMidiOutputManager`**

Remove direct navigator/permission ownership. Subscribe to `WebMidiAccess`, resolve selected output through `findOutput`, retain storage key `webchords.midi-output-id`, and preserve its external behavior and destination lifecycle callbacks. Add `dispose(): void` to unsubscribe without modifying shared access.

Instantiate one shared access service in `src/main.ts`, pass it to the output manager, and route the existing MIDI activation/restore calls through the service where required.

- [ ] **Step 8: Run Task 2 tests and type checking**

Run: `npm test -- src/midi/midi-access.test.ts src/midi/midi-output.test.ts src/output/output-controller.test.ts && npm run typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/midi/midi-access.ts src/midi/midi-access.test.ts src/midi/midi-output.ts src/midi/midi-output.test.ts src/main.ts
git commit -m "refactor: share Web MIDI access"
```

### Task 3: MIDI Input Adapter and Feedback Protection

**Files:**
- Create: `src/midi/midi-input.ts`
- Create: `src/midi/midi-input.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `WebMidiAccess`, `scaleDegreeForPitchClass`, `InstrumentStore.dispatch`, and the Task 1 press actions.
- Produces: `MidiInputStatus = 'idle' | 'requesting' | 'ready' | 'unsupported' | 'denied' | 'error' | 'disconnected' | 'suspended'`.
- Produces: `MidiInputSnapshot { status: MidiInputStatus; message: string; inputs: readonly MidiPortInfo[]; preferredInputId: string | null; attachedInputId: string | null }`.
- Produces: `parseMidiNoteMessage(data: ArrayLike<number>): { kind: 'on' | 'off'; channel: number; note: number; velocity: number } | null`.
- Produces: `WebMidiInputManager(access, getHarmony, dispatch, options?)` where `getHarmony(): Pick<InstrumentState, 'tonic' | 'mode'>` and options include storage plus `now?: () => number`.
- Produces: `selectInput(id: string | null): void`, `resume(): void`, `snapshot()`, `subscribe(listener)`, and `dispose(): void`.

- [ ] **Step 1: Write failing parser tests**

In `src/midi/midi-input.test.ts`, assert Note On and Note Off parse on channels 0 and 15, Note On velocity zero becomes Off, channel/note/velocity are returned exactly, and short/malformed messages plus control change, program change, clock, and SysEx return `null`.

- [ ] **Step 2: Run parser tests and verify failure**

Run: `npm test -- src/midi/midi-input.test.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement the pure parser**

Implement `parseMidiNoteMessage` with status-nibble checks for `0x80` and `0x90`, three-byte validation, data-byte range validation, and zero-velocity normalization. Return zero-based channels.

- [ ] **Step 4: Run parser tests and verify success**

Run: `npm test -- src/midi/midi-input.test.ts`

Expected: parser cases PASS.

- [ ] **Step 5: Add failing mapping and ownership adapter tests**

Using fake input ports, storage, harmony snapshots, and a dispatch spy, assert:

- C4 in C major dispatches degree 1 with the incoming velocity; F♯4 dispatches literal note 66;
- the owner format is `midi:<port-id>:ch:<0-15>:note:<0-127>` and matching Off dispatches release;
- the same note on different channels has independent owners;
- mapping reads harmony only on Note On, and later harmony changes do not alter release;
- duplicate Note Ons may dispatch and remain reducer-safe rather than being suppressed by adapter ownership;
- global store panic followed by the same Note On can dispatch and sound again;
- changing input releases cleanup-candidate owners before detaching the old listener;
- `dispose()` releases candidates, detaches the listener, and leaves shared access usable.

- [ ] **Step 6: Add failing persistence and reconnect tests**

Assert selecting a port persists `webchords.midi-input-id`; physical disconnect clears `attachedInputId` and releases owners but retains `preferredInputId` and storage; reconnect reattaches it; explicit `selectInput(null)` clears both preferred ID and storage.

- [ ] **Step 7: Add failing circuit-breaker boundary tests**

With an injected clock, assert the first 64 recognized Note Ons inside 100 ms dispatch, the 65th does not dispatch, status becomes suspended, the listener detaches, cleanup releases occur, and global panic is dispatched. Assert device reconnect stays suspended, while `resume()` clears the window and reattaches the preferred connected port. Note Offs and ignored messages must not increment the window.

- [ ] **Step 8: Run adapter tests and verify failure**

Run: `npm test -- src/midi/midi-input.test.ts`

Expected: FAIL because manager lifecycle and safety behavior are not implemented.

- [ ] **Step 9: Implement `WebMidiInputManager`**

Subscribe to shared access snapshots, maintain separate preferred and attached state, and keep cleanup candidates separate from authoritative reducer ownership. On Note On, count the event before dispatch, map the current pitch class to a degree or literal note, and forward velocity. On Off, dispatch release and remove the cleanup candidate. Implement targeted release for selection/disconnect/dispose, explicit suspension/resume, and the exact status copy from the spec.

- [ ] **Step 10: Wire the adapter into application state without UI**

In `src/main.ts`, instantiate the manager with `() => store.getState()` and `action => store.dispatch(action)`. Ensure page teardown invokes `dispose()` and does not dispose the shared access before the output adapter.

- [ ] **Step 11: Run Task 3 tests and type checking**

Run: `npm test -- src/midi/midi-input.test.ts src/state/instrument.test.ts src/midi/note-ledger.test.ts && npm run typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 12: Commit Task 3**

```bash
git add src/midi/midi-input.ts src/midi/midi-input.test.ts src/main.ts
git commit -m "feat: add safe MIDI input harmonizer"
```

### Task 4: MIDI Input UI and Performance Readout

**Files:**
- Modify: `src/ui/app.ts`
- Modify: `src/ui/app.test.ts`
- Modify: `src/styles.css`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `WebMidiInputManager`, `MidiInputSnapshot`, and discriminated `ActiveGesture` from Task 1.
- Produces: MIDI Input selector `#midi-input`, connect/resume control `#midi-input-action`, and status text `#midi-input-message`.
- Produces: `activateMidiInput(input: Pick<WebMidiInputManager, 'selectInput'>, id: string | null): void` and `resumeMidiInput(input: Pick<WebMidiInputManager, 'resume'>): void` as testable UI helpers.

- [ ] **Step 1: Add failing shell and visibility tests**

In `src/ui/app.test.ts`, assert the input selector and message exist when output mode is Built-in and remain present in MIDI mode. Assert output-only controls retain their existing visibility behavior.

- [ ] **Step 2: Add failing snapshot/render tests**

Assert an input snapshot populates connected ports, reflects `attachedInputId`, shows a disconnected preferred device without pretending it is attached, disables selection while permission is requesting, and renders the suspension message plus visible Resume input action.

- [ ] **Step 3: Add failing DOM recovery and selection tests**

Dispatch real `change`/`click` events and assert choosing an input calls `selectInput(id)`, choosing No input calls `selectInput(null)`, the connect action initializes shared MIDI access from a user gesture, and the suspended-state button calls `resume()` even though the preferred option remains selected.

- [ ] **Step 4: Add failing active-gesture display tests**

Assert chord gestures keep their existing name/Roman/note presentation; literal gesture MIDI 61 renders its note name, MIDI number, and `Passthrough`; literal gestures never appear in Recent Progression.

- [ ] **Step 5: Run UI tests and verify failure**

Run: `npm test -- src/ui/app.test.ts`

Expected: FAIL because the app does not accept or render MIDI input state and assumes every active gesture is a chord.

- [ ] **Step 6: Implement UI markup, binding, and rendering**

Pass the MIDI input manager and shared access into `App`. Render the independent input controls outside elements hidden by output mode, subscribe to input snapshots, bind selector/connect/resume actions, and update accessible status copy. Branch Currently Sounding rendering on `gesture.kind`; keep history chord-only.

Update `src/styles.css` only as needed to fit the input row, status, and action into the existing output panel at current responsive breakpoints.

- [ ] **Step 7: Complete main wiring and restore behavior**

Update `src/main.ts` constructor wiring. On startup always call the shared access
service's permission-aware restore; it may query permission but must request
access only when permission is already granted, so this never prompts. Keep
user-gesture initialization available from both input connect and MIDI output
selection.

- [ ] **Step 8: Run Task 4 tests and full type checking**

Run: `npm test -- src/ui/app.test.ts src/midi/midi-input.test.ts src/midi/midi-output.test.ts && npm run typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/ui/app.ts src/ui/app.test.ts src/styles.css src/main.ts
git commit -m "feat: add MIDI input controls"
```

### Task 5: User Guidance and Whole-Feature Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: completed feature behavior and exact UI copy from Tasks 1–4.
- Produces: user-facing setup and safety instructions; no new runtime API.

- [ ] **Step 1: Update usage documentation**

Document how to select a MIDI input, scale-aware chord mapping, out-of-scale passthrough, velocity behavior, and the ability to select the same physical device for input/output. Explain that hardware synth users may need Local Control Off, MIDI Thru/DAW/virtual routing can cause feedback, and the Resume input action is used only after fixing routing.

Mark the optional Web MIDI input TODO complete without changing unrelated deferred items.

- [ ] **Step 2: Run formatting and stale-copy checks**

Run: `rg -n "Add optional Web MIDI input|Reconnect input to resume|Press a chord key" README.md docs src`

Expected: the TODO phrase is marked complete, obsolete recovery copy is absent, and any remaining `Press a chord key` text is intentionally updated to include MIDI performance where appropriate.

- [ ] **Step 3: Run the complete verification suite**

Run: `npm test && npm run typecheck && npm run build && git diff --check`

Expected: all tests PASS, TypeScript and production build exit 0, and the diff has no whitespace errors.

- [ ] **Step 4: Perform manual browser verification**

Run: `npm run dev`

Verify in a Web MIDI-capable secure browser:

- permission can be initiated from MIDI input or output controls;
- one bidirectional device can be selected for both directions;
- in-scale notes produce the configured chords with audible velocity changes;
- out-of-scale notes pass through at their exact pitch;
- releases, panic, blur, device changes, and disconnects leave no stuck notes;
- when a virtual loopback port is available, a deliberate loop suspends input,
  silences output, and Resume works only after routing is corrected;
- built-in output remains usable from MIDI input.

- [ ] **Step 5: Commit Task 5**

```bash
git add README.md docs/TODO.md
git commit -m "docs: explain MIDI input workflow"
```

- [ ] **Step 6: Request final code review**

Use `superpowers:requesting-code-review` against the complete branch, address any accepted findings, then rerun `npm test && npm run typecheck && npm run build && git diff --check` before reporting completion.
