export type Cleanup = () => void;

export class CleanupStack {
  readonly #cleanups: Cleanup[] = [];
  readonly #registered = new WeakSet<Cleanup>();
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  add(cleanup: Cleanup): Cleanup {
    if (this.#registered.has(cleanup)) return cleanup;
    this.#registered.add(cleanup);
    if (this.#disposed) this.#run(cleanup);
    else this.#cleanups.push(cleanup);
    return cleanup;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    while (this.#cleanups.length) this.#run(this.#cleanups.pop()!);
  }

  #run(cleanup: Cleanup): void {
    try {
      cleanup();
    } catch {
      // Continue with the remaining resources.
    }
  }
}
