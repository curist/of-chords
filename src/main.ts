import './styles.css';
import { WebAudioSynthSink } from './audio/synth';
import { GamepadInput, type FrameScheduler, type GamepadEventTarget, type GamepadNavigator } from './input/gamepad';
import { KeyboardInput, type KeyboardEventTarget } from './input/keyboard';
import { createApplicationDisposer } from './lifecycle/application-disposer';
import { CleanupStack } from './lifecycle/cleanup-stack';
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

const resources = new CleanupStack();
let panic = () => {};
const dispose = createApplicationDisposer(resources, () => panic());
try {
  const synth = new WebAudioSynthSink();
  const midiAccess = new WebMidiAccess();
  const midi = new WebMidiOutputManager(midiAccess);
  resources.add(() => midi.dispose());
  const output = new OutputController(synth, midi, { storage: safeLocalStorage() });
  const ledger = new NoteLedger(output);
  const store = new InstrumentStore({
    acquire: (owner, notes, velocity) => ledger.acquire(owner, notes, velocity),
    release: (owner) => ledger.release(owner),
    panic: () => ledger.panic(),
    programChange: (program) => midi.programChange(program),
  });
  panic = () => store.dispatch({ type: 'panic' });
  const midiInput = new WebMidiInputManager(
    midiAccess,
    () => store.getState(),
    (action) => store.dispatch(action),
    { storage: safeLocalStorage() },
  );
  resources.add(() => midiInput.dispose());
  resources.add(bindDestinationLifecycle(output, midi, (action) => store.dispatch(action)));
  const app = new App(root, store, midi, output, synth, midiInput, midiAccess);
  resources.add(() => app.dispose());

  void midiAccess.restoreIfPermitted();
  resources.add(new KeyboardInput(window as unknown as KeyboardEventTarget, (action) => store.dispatch(action)).attach());
  resources.add(new GamepadInput(
    window as unknown as GamepadEventTarget,
    navigator as unknown as GamepadNavigator,
    {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (id) => cancelAnimationFrame(id),
    } satisfies FrameScheduler,
    (action) => store.dispatch(action),
    (status) => app.setGamepadStatus(status),
  ).attach());

  const onPageHide = (event: PageTransitionEvent) => handlePageHide(event, dispose, panic);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') panic();
  };
  window.addEventListener('blur', panic);
  resources.add(() => window.removeEventListener('blur', panic));
  window.addEventListener('pagehide', onPageHide);
  resources.add(() => window.removeEventListener('pagehide', onPageHide));
  document.addEventListener('visibilitychange', onVisibilityChange);
  resources.add(() => document.removeEventListener('visibilitychange', onVisibilityChange));
  import.meta.hot?.dispose(dispose);
} catch (error) {
  dispose();
  throw error;
}

function safeLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
