import type { StorageLike } from './storage';

export class PersistedDevicePreference {
  constructor(
    private readonly storage: StorageLike | null,
    private readonly idKey: string,
    private readonly labelKey: string,
  ) {}

  id(): string | null {
    try { return this.storage?.getItem(this.idKey) ?? null; } catch { return null; }
  }

  label(): string | null {
    try { return this.storage?.getItem(this.labelKey) ?? null; } catch { return null; }
  }

  set(id: string, label: string): void {
    try { this.storage?.setItem(this.idKey, id); } catch { /* Storage is optional. */ }
    try { this.storage?.setItem(this.labelKey, label); } catch { /* Storage is optional. */ }
  }

  clear(): void {
    try { this.storage?.removeItem(this.idKey); } catch { /* Storage is optional. */ }
    try { this.storage?.removeItem(this.labelKey); } catch { /* Storage is optional. */ }
  }
}
