export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getOptionalStorage(provider: () => StorageLike = () => localStorage): StorageLike | null {
  try {
    return provider();
  } catch {
    return null;
  }
}
