export interface Disposable {
  dispose(): void;
}

export function handlePageHide(
  event: Pick<PageTransitionEvent, 'persisted'>,
  midiInput: Disposable,
  midiOutput: Disposable,
  panic: () => void,
): void {
  panic();
  if (event.persisted) return;
  midiInput.dispose();
  midiOutput.dispose();
}
