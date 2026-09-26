import './styles.css';
import { WebAudioSynthSink } from './audio/synth';
import { KeyboardInput, type KeyboardEventTarget } from './input/keyboard';
import { NoteLedger } from './midi/note-ledger';
import { WebMidiOutputManager } from './midi/midi-output';
import { OutputController } from './output/output-controller';
import { InstrumentStore } from './state/store';
import { App } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element.');

const synth = new WebAudioSynthSink();
const midi = new WebMidiOutputManager();
const output = new OutputController(synth, midi, { storage: safeLocalStorage() });
const ledger = new NoteLedger(output);
const store = new InstrumentStore({
  acquire: (owner, notes) => ledger.acquire(owner, notes),
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

new App(root, store, midi, output, synth);
new KeyboardInput(window as unknown as KeyboardEventTarget, (action) => store.dispatch(action)).attach();

const panic = () => store.dispatch({ type: 'panic' });
window.addEventListener('blur', panic);
window.addEventListener('pagehide', panic);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') panic();
});

void midi.initialize();

function safeLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
