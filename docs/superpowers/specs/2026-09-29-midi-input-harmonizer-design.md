# MIDI Input Harmonizer Design

## Intent

Let a player use a MIDI keyboard as a harmonic controller for Of Chords. Notes
inside the selected scale trigger the corresponding diatonic chord; notes
outside the scale pass through unchanged. The result is sent through whichever
sound output is active, including a MIDI output on the same physical device as
the selected input.

Success means playing and releasing a MIDI key produces and releases exactly
one owned musical gesture, input velocity remains expressive, overlapping notes
do not hang, device reconnects remain understandable, and an accidental MIDI
routing loop cannot run unchecked.

## Scope

The first release includes:

- A persistent, independently selectable Web MIDI input.
- Scale-aware mapping from input pitch class to degree I through VII.
- Exact note passthrough for pitch classes outside the selected scale.
- Input-velocity propagation to generated chords and passthrough notes.
- Note On, Note Off, and Note On with velocity zero semantics on every MIDI
  channel.
- Safe use of input and output ports exposed by the same physical device.
- Connection-state handling, panic integration, and a feedback-loop circuit
  breaker.
- Unit tests for parsing, mapping, ownership, velocity, port lifecycle, and
  circuit-breaker behavior.

The first release does not include:

- Sustain pedal, pitch bend, aftertouch, polyphonic expression, program input,
  clock, SysEx, or other MIDI messages.
- Input-channel filters, channel remapping, splits, transposition, or learn
  mode.
- Per-device profiles or device-specific Local Control configuration.
- Recording, sequencing, quantization, or arpeggiation.

## Musical Mapping

Mapping uses the current tonic and mode at Note On time. The input note's pitch
class is compared enharmonically with the seven pitch classes in the current
scale:

- A matching pitch class dispatches the corresponding degree press, anchored
  on the exact input note. The harmony engine applies the current chord shape,
  then stacks its intervals above the input note so that note is always the
  chord's lowest key. MIDI-triggered chords ignore the app's inversion setting;
  inversion continues to affect keyboard, pointer, and gamepad gestures.
- A non-matching pitch class dispatches a literal-note press containing the
  exact input MIDI note number.

The complete result of a press is snapshotted under that input key's owner.
Changes to tonic, mode, chord shape, or inversion while the key is held affect
only later presses. Note Off releases the snapshot started by its matching Note
On, even if musical settings have since changed.

MIDI Note On velocity is clamped to the valid `1...127` range and accompanies
the acquire effect. A generated chord applies that velocity to every newly
sounding chord tone. A passthrough note keeps the same velocity. Note On with
velocity zero is handled as Note Off, following standard MIDI convention.

When multiple owners share an output note, the reference-counted ledger emits
only its first Note On and final Note Off. A later owner therefore does not
retrigger an already sounding shared tone or replace its original attack
velocity. This preserves the existing no-retrigger ownership invariant.

## MIDI Architecture

Browser MIDI permission and port discovery move into one shared Web MIDI access
service. It owns the single `MIDIAccess`, exposes snapshots of connected input
and output ports, restores access only when permission is already granted, and
publishes state changes to its consumers.

The service owns the sole `MIDIAccess.onstatechange` handler for its lifetime
and fans out immutable snapshots. It caches a successfully obtained access
object. Concurrent initialization calls share one in-flight promise; a failed
request clears that promise so a later explicit user gesture can retry.
Unsubscribing or disposing one consumer never closes access, clears the shared
state-change handler, or interrupts the other consumer.

Two focused adapters consume that service:

- The MIDI output adapter retains responsibility for output selection,
  persistence, note messages, program changes, and output-loss reporting.
- The MIDI input adapter owns input selection, persistence, message parsing,
  input listeners, input-loss reporting, and dispatching instrument actions.

The input and output selections are independent. They may refer to ports with
the same device name because Web MIDI represents directions as separate
`MIDIInput` and `MIDIOutput` ports. No port-name or identifier comparison blocks
that configuration. Selecting either kind of port may request the shared MIDI
permission from a user gesture; concurrent requests reuse the same in-flight
promise.

The active sound output remains independent of input. A selected MIDI input can
drive the built-in synth or the selected MIDI output through the existing
`OutputController` and `NoteLedger` path. MIDI output continues on channel 1;
input accepts note messages from all 16 channels.

## Input Parsing and Ownership

The input adapter recognizes channel-voice status bytes `0x80...0x8f` and
`0x90...0x9f`. It ignores malformed messages, data outside the MIDI byte ranges,
and all other statuses.

Each held key has an owner identifier containing the selected input port ID,
input channel, and input note number. Consequently, the same note on different
channels is independently owned. A repeated Note On for an owner that is
already held may be dispatched, but the reducer ignores it through its existing
idempotent press semantics. Note Off for an owner that is not held is harmless.

Instrument state is authoritative for whether an owner is active. The adapter
keeps only a set of owner IDs that may need targeted cleanup when its port is
changed, disconnected, or disposed; it does not use that set to suppress Note
Ons. This distinction keeps the adapter correct after a global panic clears
instrument state: a subsequent Note On for the same port/channel/note can sound
again, and a later redundant targeted release remains harmless.

Changing or losing the selected input first releases every owner belonging to
that input, then detaches its message listener. This targeted cleanup leaves
keyboard, pointer, and gamepad owners sounding. Global panic, window blur, page
hiding, output changes, and program changes retain their existing behavior and
clear MIDI-input-owned notes along with all other owners.

Literal-note input extends instrument actions without bypassing state or the
ledger. The reducer records a literal active gesture with its exact note and
velocity, emits the same acquire/release effects as a chord gesture, and makes
it visible in the Currently Sounding view. Degree presses also carry an
optional velocity; existing keyboard, pointer, and gamepad presses use the
current default velocity.

The ledger's acquire operation accepts a velocity. It forwards that velocity
only for notes whose global reference count changes from zero to one. The
built-in synth and MIDI output already accept velocity through the common
`NoteSink` interface; tests verify the propagation end to end.

## Feedback-Loop Safety

Ordinary use of an input and output belonging to the same hardware device is
not itself a loop: the ports are directional, and typical devices do not echo
received output back to their input. A loop can still be created externally by
MIDI Thru, a DAW, or virtual-port routing. MIDI 1.0 note messages carry no origin
identifier, so Of Chords cannot reliably distinguish a reflected message from
a genuine performance.

The MIDI input adapter therefore maintains a rolling timestamp window for
recognized Note On messages from the selected port, using an injectable
monotonic clock. It permits the first 64 Note Ons in any rolling 100
milliseconds. Before dispatching each Note On, it prunes expired timestamps and
counts the new event; the 65th trips the breaker and is not dispatched. On a
trip, the adapter:

1. Stops processing and detaches the selected input listener synchronously.
2. Releases every owner belonging to that input.
3. Dispatches global panic to silence any output notes whose routing history is
   uncertain.
4. Keeps the preferred input visible but marks it suspended, exposes a `Resume
   input` action, and reports `Possible MIDI feedback loop detected. Check MIDI
   routing, then resume input.`

The threshold is intentionally well above normal keyboard performance but low
enough to stop exponential or repeated routing quickly. Note Offs do not
increment the detector. Activating `Resume input` explicitly clears the window,
reattaches the preferred port if it is connected, and resumes processing;
automatic device reconnection never clears a tripped breaker.

This protection limits event storms but is not a substitute for disabling MIDI
Thru in an incorrectly routed setup. The UI documentation states that hardware
synth users may also need Local Control Off to avoid hearing both the direct
key and the returned harmonization.

## UI and Persistence

> **Later UI refinement:** MIDI Input was subsequently promoted into its own
> Controller input panel, separate from Sound output. The independence described
> below is unchanged; only its visual placement was superseded.

The output panel gains a separate MIDI Input selector alongside the existing
MIDI Output selector. Input controls remain available regardless of whether the
active sound output is Built-in or MIDI. Before access is granted, the selector
offers a clear connect action; afterward it lists connected input ports.

The input adapter distinguishes `preferredInputId` from its currently attached
port. The preferred ID is persisted independently from the output ID. Selecting
a port replaces it; explicitly choosing No input clears it. A physical
disconnect detaches the listener and releases the port's owners but retains the
preferred ID, allowing automatic reattachment when that port returns. On load,
the app restores MIDI access only when browser permission is already granted,
then attaches the preferred port if it is connected. Feedback suspension also
retains the preferred ID but prevents automatic attachment until the explicit
Resume action.

Input status distinguishes idle, requesting, ready, unsupported, denied, error,
disconnected, and feedback-suspended states. Port state changes refresh both
selectors from the shared access snapshot without duplicating browser access
requests.

For a scale-mapped note, Currently Sounding uses the existing chord name, Roman
numeral, and voiced notes. For passthrough, it shows the input note name and MIDI
number with a `Passthrough` label. Recent Progression continues to contain only
generated chords; literal passthrough notes do not add harmonic-history entries.

## Failure and Lifecycle Behavior

- Permission denial and unsupported browsers leave keyboard, pointer, gamepad,
  and built-in audio behavior unchanged.
- An input disconnection releases only that input's owners and reports the
  missing selection. Reconnection restores the remembered port and listener
  unless the feedback breaker was tripped.
- An output disconnection follows the existing output panic behavior. The MIDI
  input may remain selected and can drive the built-in synth after the user
  changes output mode.
- Parsing or dispatch errors from one MIDI message are contained at the input
  boundary and do not detach a healthy device. Ownership cleanup is still
  attempted during disconnect and selection changes.
- The MIDI input adapter exposes `dispose()`. Application page teardown calls
  it to detach the input listener, release its cleanup-candidate owners, and
  unsubscribe from shared access without affecting MIDI output.

## Testing

Pure mapping tests cover every degree of several modes and tonics, octave
equivalence, enharmonic pitch-class matching, and exact chromatic passthrough.
Parser tests cover all channels, Note On, Note Off, zero-velocity Note On,
ignored message classes, and malformed data.

Reducer and ledger tests verify velocity propagation, held-note snapshots,
literal-note state, shared-tone reference counts, duplicate Note Ons, unmatched
Note Offs, targeted input cleanup, and unchanged default velocity for existing
inputs.

Adapter tests use fake MIDI access and ports to verify permission deduplication,
failed-request retry, independent same-device input/output selection, stored
selection restoration, disconnect retaining the preferred ID versus explicit
No input clearing it, reconnect behavior, one adapter's disposal leaving the
other operational, listener cleanup, all-channel owner identities, global
panic followed by retrigger of the same owner, and circuit-breaker suspension.
Circuit-breaker tests use the injected clock to verify that the first 64 events
are dispatched, the 65th is rejected, automatic reconnect stays suspended, and
the explicit Resume action restores processing. UI tests exercise that Resume
action through the real DOM event path and verify selector visibility in both
output modes, statuses, passthrough display, and unchanged chord-only
progression history.

The final verification runs the complete unit-test suite, TypeScript checking,
and the production build. Manual browser verification uses one bidirectional
device when available and confirms that normal same-device routing does not
trip the detector, while a deliberate virtual loop is stopped and silenced.
