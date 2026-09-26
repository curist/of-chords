import './styles.css';
import { KeyboardInput, type KeyboardEventTarget } from './input/keyboard';
import { NoteLedger } from './midi/note-ledger';
import { WebMidiOutputManager } from './midi/midi-output';
import { InstrumentStore } from './state/store';
import { App } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element.');

const midi = new WebMidiOutputManager();
const ledger = new NoteLedger(midi);
const store = new InstrumentStore(ledger);
midi.onDestinationWillChange(() => store.dispatch({ type: 'panic' }));

new App(root, store, midi);
new KeyboardInput(window as unknown as KeyboardEventTarget, (action) => store.dispatch(action)).attach();

const panic = () => store.dispatch({ type: 'panic' });
window.addEventListener('blur', panic);
window.addEventListener('pagehide', panic);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') panic();
});

void midi.initialize();
