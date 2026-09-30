export function handlePageHide(
  event: Pick<PageTransitionEvent, 'persisted'>,
  dispose: () => void,
  panic: () => void,
): void {
  if (event.persisted) panic();
  else dispose();
}
