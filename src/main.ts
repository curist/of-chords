import './styles.css';
import { WebAudioSynthSink } from './audio/synth';
import { GamepadInput, type FrameScheduler, type GamepadEventTarget, type GamepadNavigator } from './input/gamepad';
import { KeyboardInput, type KeyboardEventTarget } from './input/keyboard';
import { WebMidiAccess } from './midi/midi-access';
import { NoteLedger } from './midi/note-ledger';
import { WebMidiOutputManager } from './midi/midi-output';
import { OutputController } from './output/output-controller';
import { InstrumentStore } from './state/store';
import { App } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element.');

const synth = new WebAudioSynthSink();
const midiAccess = new WebMidiAccess();
const midi = new WebMidiOutputManager(midiAccess);
const output = new OutputController(synth, midi, { storage: safeLocalStorage() });
const ledger = new NoteLedger(output);
const store = new InstrumentStore({
  acquire: (owner, notes, velocity) => ledger.acquire(owner, notes, velocity),
  release: (owner) => ledger.release(owner),
  panic: () => ledger.panic(),
  programChange: (program) => midi.programChange(program),
});
// Releasing held notes before the destination changes prevents stuck voices,
// whether we swap MIDI devices or switch between the built-in voice and MIDI.
output.onWillChange(() => store.dispatch({ type: 'panic' }));
output.onDidChange(() => store.dispatch({ type: 'resend-program' }));
midi.onDestinationWillChange(() => store.dispatch({ type: 'panic' }));
midi.onDestinationDidChange(() => store.dispatch({ type: 'resend-program' }));

const app = new App(root, store, midi, output, synth);
if (output.mode === 'midi') void midiAccess.restoreIfPermitted();
new KeyboardInput(window as unknown as KeyboardEventTarget, (action) => store.dispatch(action)).attach();
new GamepadInput(
  window as unknown as GamepadEventTarget,
  navigator as unknown as GamepadNavigator,
  {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
  } satisfies FrameScheduler,
  (action) => store.dispatch(action),
  (status) => app.setGamepadStatus(status),
).attach();

const panic = () => store.dispatch({ type: 'panic' });
window.addEventListener('blur', panic);
window.addEventListener('pagehide', panic);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') panic();
});

function safeLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
