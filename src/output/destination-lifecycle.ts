import type { WebMidiOutputManager } from '../midi/midi-output';
import type { InstrumentAction } from '../state/instrument';
import type { OutputController } from './output-controller';

type OutputLifecycle = Pick<OutputController, 'mode' | 'onWillChange' | 'onDidChange'>;
type MidiDestinationLifecycle = Pick<WebMidiOutputManager, 'onDestinationWillChange' | 'onDestinationDidChange'>;

/** Connects destination changes to the active instrument's note and patch lifecycle. */
export function bindDestinationLifecycle(
  output: OutputLifecycle,
  midi: MidiDestinationLifecycle,
  dispatch: (action: InstrumentAction) => void,
): () => void {
  const unsubscribers = [
    output.onWillChange(() => dispatch({ type: 'panic' })),
    output.onDidChange(() => {
      if (output.mode === 'midi') dispatch({ type: 'resend-program' });
    }),
    midi.onDestinationWillChange(() => {
      if (output.mode === 'midi') dispatch({ type: 'panic' });
    }),
    midi.onDestinationDidChange(() => {
      if (output.mode === 'midi') dispatch({ type: 'resend-program' });
    }),
  ];
  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
