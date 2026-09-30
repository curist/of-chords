import './styles.css';
import { WebAudioSynthSink } from './audio/synth';
import { GamepadInput, type FrameScheduler, type GamepadEventTarget, type GamepadNavigator } from './input/gamepad';
import { KeyboardInput, type KeyboardEventTarget } from './input/keyboard';
import { handlePageHide } from './lifecycle/page-lifecycle';
import { WebMidiAccess } from './midi/midi-access';
import { WebMidiInputManager } from './midi/midi-input';
import { NoteLedger } from './midi/note-ledger';
import { WebMidiOutputManager } from './midi/midi-output';
import { bindDestinationLifecycle } from './output/destination-lifecycle';
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
const midiInput = new WebMidiInputManager(
  midiAccess,
  () => store.getState(),
  (action) => store.dispatch(action),
  { storage: safeLocalStorage() },
);
const cleanupDestinationLifecycle = bindDestinationLifecycle(output, midi, (action) => store.dispatch(action));
// Retained for the app-wide cleanup stack introduced in Task 2.
void cleanupDestinationLifecycle;

const app = new App(root, store, midi, output, synth, midiInput, midiAccess);
void midiAccess.restoreIfPermitted();
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
window.addEventListener('pagehide', (event) => handlePageHide(event, midiInput, midi, panic));
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
