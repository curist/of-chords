# Analog Voicing Steering Design

## Intent

Give Of Chords a second, analog dimension of performance without weakening its
core interaction: seven physical buttons remain the seven harmonic degrees,
while the left analog stick steers how the focused chord is voiced. The gesture
is live and reversible:

```text
hold chord → move stick → hear its voicing change → return to center → hear the exact baseline
```

Success means a player can make a held progression feel higher, lower, or more
open without selecting textbook inversions, shared tones remain stable during
revoicing, overlapping chord ownership remains correct, and neutral input is as
predictable as the instrument is today.

This first release ships left-stick voicing steering only. It deliberately
creates a harmony pipeline that can later accept right-stick tension and
harmonic-neighborhood transformations without embedding gamepad concepts in the
music engine.

## Scope

The release includes:

- Live revoicing of the last-pressed chord that is still held.
- Vertical voicing intent on the left-stick Y axis.
- Directional opening intent on the left-stick X axis.
- Analog strength, radial dead-zone handling, and selection hysteresis.
- Candidate generation and scoring for triads, sevenths, sus2, and sus4 chords.
- Atomic replacement of one owner's notes in the reference-counted note ledger.
- A focused-chord marker and a compact, human-readable voicing-intent label.
- Identical note-event behavior for the built-in synth and external MIDI.

The release does not include:

- Right-stick harmonic tension or harmonic-neighborhood mappings.
- Changes to chord pitch classes, quality, extensions, or Roman numeral.
- Pitch bend, oscillator retuning, glissando, or MIDI Polyphonic Expression.
- Continuously interpolated pitches.
- User-facing dead-zone, hysteresis, or scoring controls.
- A full XY visualization or four-part voice editor.

## Musical Gesture

The stick expresses preference rather than selecting a numbered inversion.

- Center restores the focused chord's exact baseline notes.
- Up biases the voicing's center of gravity upward.
- Down biases the voicing's center of gravity downward.
- Right opens upward by lifting upper voices.
- Left opens downward by lowering lower voices.
- Diagonal movement combines vertical and opening intent.
- Distance from center controls how strongly the voicer favors the requested
  transformation.

The X axis is symmetric because Of Chords' baseline voicings are already close.
Mapping left to “more closed” would frequently do nothing; opening below and
opening above makes both directions musically active while preserving a stable
center.

Revoicing uses discrete MIDI-note candidates. “Live” means that the sounding
candidate changes as the stick crosses meaningful scoring boundaries, not that
pitches glide continuously. A dead zone makes neutral input exact, and
hysteresis prevents stick noise from alternating rapidly between candidates.

## Input-Neutral Performance Intent

Input adapters publish normalized musical intent rather than music-engine or
MIDI commands:

```ts
interface PerformanceIntent {
  readonly voicing: {
    readonly vertical: number; // -1 downward … +1 upward
    readonly opening: number;  // -1 open below … +1 open above
  };
}
```

The gamepad adapter reads the left-stick axes, accounts for the browser's
positive-down Y convention, applies a radial dead zone, rescales the remaining
radius to the full 0–1 range, and dispatches intent only when its normalized
value changes meaningfully. It does not resolve chords, generate notes, or know
about output destinations.

The first release gives one gamepad analog authority at a time: the connected
gamepad with the lowest browser gamepad index. Other connected gamepads may
still press chord buttons, but their analog axes are ignored until they become
the authority. This deterministic rule prevents two polling sources from
overwriting one global intent. If authority changes, the controller adapter
first dispatches one atomic controller reset, then the newly authoritative
gamepad may publish its sampled intent on the following poll.

The intent type is intentionally independent of sticks. A future MIDI control,
touch surface, or accessibility input can produce the same voicing intent. The
first release does not add unused `tension`, `neighborhood`, or `expression`
fields merely to anticipate later work.

## Instrument State and Focus Ownership

Instrument state gains:

- The current `PerformanceIntent`.
- An ordered collection of held chord owners.
- An immutable baseline-note snapshot for each active chord.
- The currently sounding steered notes for each active chord.
- An immutable voice-leading anchor for each active chord, captured from the
  previously focused chord when the new chord is pressed.

The most recently pressed owner that remains held is the focused chord. Only the
focused chord responds to performance-intent updates.

Lifecycle rules:

1. Pressing a chord adds its owner to the top of the focus order. It sounds at
   the baseline when the stick is centered, or immediately uses the current
   intent when the stick is displaced.
2. Moving the stick revoices the focused chord live.
3. Pressing another chord leaves earlier chords sounding unchanged and transfers
   focus to the new chord.
4. Releasing a non-focused chord does not affect focus or revoice another chord.
5. Releasing the focused chord transfers focus to the previous still-held owner
   and immediately applies the current stick intent to it.
6. Returning the stick to its dead zone restores the focused chord's immutable
   baseline notes.
7. Disconnecting the authoritative controller dispatches one atomic controller
   reset. The reducer centers intent, restores all surviving owners to baseline,
   removes every owner belonging to that controller from the held and focus
   collections, and emits the complete note delta as one effect. It
   must not process those owners as a sequence of ordinary releases, because
   that could briefly apply displaced intent to a fallback chord. A subsequent
   poll may promote the next-lowest connected gamepad and apply its intent.
   Disconnecting a non-authoritative controller atomically removes only that
   controller's owners and does not change current intent. If one of those
   owners was focused, focus falls back within the same transaction and the
   unchanged authoritative intent is applied immediately to the fallback owner.
8. Panic, window blur, and page hiding continue to release all owners.

The baseline never changes after a chord is pressed. Repeated transformations,
focus transfers, and intermediate candidates therefore cannot redefine what
“center” means.

All paths that clear active notes—including panic, program/output changes that
currently panic, blur, and page hiding—also clear held-owner order, focus,
baselines, sounding-note snapshots, voice-leading anchors, and hysteresis
selections, and reset performance intent to center. There must never be
performance state for an owner absent from the active-note ledger.

## Voicing Candidate Generation

The pure voicing engine receives the chord tones, baseline notes, current
sounding notes, the owner's voice-leading anchor, and normalized voicing
intent. It generates candidates around the baseline rather than mutating
oscillator or MIDI state.

The anchor is a note-array snapshot of the previously focused owner's sounding
voicing at press time. It is not updated by later stick movement and is deleted
with its owner. If no chord was focused at press time, the new owner has no
anchor. This gives a newly pressed chord progression context without allowing
overlapping chords or focus fallback to mutate one another's scoring history.

For the chord's three or four pitch classes, candidate generation includes:

- Every inversion across nearby octaves.
- Closed positions.
- Upward-open positions formed by lifting selected upper tones by an octave.
- Downward-open positions formed by lowering selected lower tones by an octave.

The initial generator does not add doubled tones. Every candidate must:

- Contain exactly the chord's pitch classes and tone count.
- Be strictly ascending.
- Stay inside a named, tested playable MIDI range around the current register.
- Avoid voice crossing.
- Keep adjacent voices inside a generous named maximum interval.

Generation must be deterministic and deduplicate equivalent MIDI-note arrays.
Named constants define the candidate octave window and range limits so tests can
exercise their behavioral boundaries.

## Candidate Scoring and Selection

Each valid candidate receives a score composed of independently testable terms:

```text
score =
  baselineDistance
  + transitionMovement
  + largeLeapPenalty
  + registerBoundaryPenalty
  + verticalMagnitudeMismatch
  + openingMagnitudeMismatch
```

- `baselineDistance` makes the exact legacy notes dominant at neutral input.
- `transitionMovement` favors retained common tones and short motion from the
  chord's current sounding notes, with the immutable voice-leading anchor used
  when selecting its first displaced candidate.
- `largeLeapPenalty` discourages unexplained octave jumps in individual voices.
- `registerBoundaryPenalty` keeps candidates away from uncomfortable extremes.
- Each candidate exposes `realizedVertical` in `-1…1`: its center-of-gravity
  delta from baseline divided by the named maximum vertical displacement and
  clamped to that range. `verticalMagnitudeMismatch` is the squared difference
  between that value and requested `vertical`, multiplied by a named weight.
- Each candidate exposes `realizedOpening` in `-1…1`: negative for span added
  below baseline and positive for span added above, normalized by the named
  maximum opening and clamped. `openingMagnitudeMismatch` is the squared
  difference between that value and requested `opening`, multiplied by a named
  weight.

Consequently, stick distance requests a target amount rather than merely
turning a directional preference on. Candidate discreteness means the audible
result changes at boundaries, but increasing axis magnitude must select
non-decreasing realized magnitude, subject to range constraints and hysteresis.

The selector enforces that property rather than relying on score weights. For
each axis independently, movement is *outward* when the new input keeps the
same non-zero sign and its absolute magnitude is greater than the previous
input. During outward movement, candidates whose realized magnitude on that
axis is smaller than the currently selected candidate are ineligible. A
direction change or inward movement removes that constraint, allowing the
voicing to come back naturally. Hysteresis is evaluated only among eligible
candidates and cannot retain an ineligible candidate. Neutral input still
bypasses all selection and restores the baseline. This state and the previous
normalized input are reset with the owner's other hysteresis state.

Neutral input bypasses optimization and returns the exact baseline. This is a
hard invariant, not merely a large scoring weight.

The current candidate remains selected until a challenger improves the score by
a named hysteresis margin. Candidate identity, rather than raw axis movement,
drives note replacement, so polling the same intent produces no note events.
Ties use deterministic ordering to keep tests, built-in audio, and MIDI output
repeatable.

## Atomic Note Replacement

The note ledger gains an operation that replaces the notes owned by one active
owner without releasing and reacquiring the entire chord. Given the owner's old
and new unique-note sets, it computes:

- Retained notes: ownership and output remain unchanged.
- Added notes: increment reference counts and emit Note On only when the global
  count changes from zero to one.
- Removed notes: decrement reference counts and emit Note Off only when the
  global count changes from one to zero.

The ledger updates its complete ownership/reference state as one synchronous
operation. It starts genuinely new notes before stopping genuinely removed
notes, avoiding a momentary silent hole during a voicing change. As today,
output exceptions do not leave ledger ownership internally inconsistent.

For controller reset and other transitions that change several owners at once,
the ledger also exposes bulk reconciliation. Its input is the complete desired
owner-to-note map after the reducer transaction. It diffs that map against the
complete current map, computes reference-count changes globally, installs the
new ownership and count state synchronously, emits every global zero-to-one
Note On, and only then emits every global one-to-zero Note Off. Notes whose
global count remains non-zero emit neither event, even if ownership moves
between owners. The reducer represents an atomic multi-owner transition as one
bulk-reconcile effect rather than a list of per-owner replacements and releases.

This produces ordinary Note On and Note Off events. The built-in synth uses its
existing short attack and release envelopes; external MIDI receives the same
discrete, portable behavior. Shared tones within a chord or across simultaneously
held chords are not retriggered or prematurely released.

## UI and Feedback

The existing “Currently sounding” panel continues to display actual note names
and MIDI numbers, updating whenever the focused chord is revoiced. Its
owner-specific row receives a small `Focused` marker and a compact intent
description:

- `Voicing centered`
- `Moving up`
- `Moving down`
- `Open above`
- `Open below`
- Combined diagonal descriptions such as `Moving up · open above`

The chord's name and Roman numeral remain unchanged because voicing steering
does not alter its harmonic identity. The initial release does not expose
inversion numbers, scoring values, or a full stick visualization.

Degree pads retain their existing aggregate active state and do not show focus.
This remains unambiguous when two input owners hold the same degree because the
focus marker belongs to a Currently Sounding owner row rather than the pad.

Keyboard and pointer players retain existing behavior. Without a connected
analog controller, intent remains centered and the focused marker is still
allowed to identify ownership, but no controller-specific instructional chrome
is added.

## Future Right-Stick Tension and Harmonic Neighborhoods

Right-stick exploration is deferred from implementation but explicitly shapes
the boundary between harmony and voicing:

```text
base chord intent
→ harmonic transformation candidate set
→ voicing candidate generation
→ left-stick voicing scoring
→ sounding notes
```

A later tension axis can progressively introduce chord-appropriate sevenths,
ninths, elevenths, thirteenths, suspensions, or alterations. A two-dimensional
harmonic-neighborhood gesture can offer related variants, modal mixture,
secondary functions, or neighboring diminished chords. Those systems choose or
transform pitch-class sets; the voicing engine then places their tones using the
same left-stick intent and transition scoring.

The future design must update chord names, Roman-numeral analysis, and theory
feedback to reflect transformed harmony. This is why tension/neighborhood logic
must not be smuggled into the voicing scorer. Exact mappings, theory rules, and
how a right stick returns to baseline require a separate approved design.

## Testing

Pure unit tests cover:

- Axis normalization, positive-down Y inversion, radial dead-zone rescaling,
  drift suppression, and meaningful-change dispatch.
- Deterministic lowest-index analog authority, ignored secondary axes,
  authority promotion, and two-controller connect/poll/disconnect sequences.
- Candidate validity, range bounds, deduplication, and deterministic ordering.
- Exact baseline output at neutral intent.
- Higher/lower center-of-gravity preference from Y input.
- Upward/downward opening preference from X input.
- Non-decreasing realized transformation strength as stick magnitude increases.
- Outward-motion eligibility, inward release of that constraint, direction
  changes, and hysteresis never retaining an ineligible candidate.
- Combined diagonal intent.
- Stable candidate selection within the hysteresis margin.
- Focus assignment, last-pressed-held fallback, and non-focused release.
- Immediate application of current intent when focus transfers.
- Live replacement and exact restoration on return to center.
- Atomic controller reset and baseline restoration on disconnect, with no
  transient fallback revoice or intermediate note-event burst.
- Bulk ledger reconciliation for simultaneous restore and removal, including
  notes shared by surviving and disconnected owners, global Note On-before-Off
  ordering, and no event when a global reference count stays non-zero.
- Complete correlated-state cleanup on panic, blur, page hiding, and output or
  program changes that clear active notes.
- Atomic ledger replacement, shared-note retention, reference counts, Note On
  before Note Off ordering, and exception resilience.
- Triad, seventh, sus2, and sus4 behavior.
- Existing keyboard, pointer, built-in synth, and MIDI behavior remaining
  unchanged at neutral intent.

The production build and TypeScript compilation remain required verification.
Musical acceptance uses at least `I → vi → IV → V` and confirms:

- Center reproduces today's voicings exactly.
- Up/right produces an audibly rising, upward-open interpretation.
- Down/left produces an audibly descending, downward-open interpretation.
- Common tones do not audibly retrigger.
- Rapid movement near a boundary does not chatter.
- Holding multiple chord buttons never creates stuck or prematurely released
  notes.

## Delivery and Branching

The written specification and implementation plan are completed and approved
before production work begins. Implementation starts on a new feature branch
created from the then-current clean `main` branch. Work is divided so the pure
candidate engine and ledger replacement can be reviewed independently from
gamepad polling and UI feedback.
