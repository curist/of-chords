import { CleanupStack, type Cleanup } from './cleanup-stack';

export function createApplicationDisposer(resources: CleanupStack, panic: Cleanup): Cleanup {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    try {
      panic();
    } catch {
      // Cleanup must continue even if the final panic fails.
    } finally {
      resources.dispose();
    }
  };
}
