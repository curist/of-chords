import { describe, expect, it } from 'vitest';
import { PersistedDevicePreference } from './device-preference';

const ID_KEY = 'device-id';
const LABEL_KEY = 'device-label';

describe('PersistedDevicePreference', () => {
  it('reads, writes, and clears both values', () => {
    const values = new Map<string, string>();
    const preference = new PersistedDevicePreference({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    }, ID_KEY, LABEL_KEY);

    expect(preference.id()).toBeNull();
    expect(preference.label()).toBeNull();
    preference.set('port-1', 'Keyboard');
    expect([preference.id(), preference.label()]).toEqual(['port-1', 'Keyboard']);
    preference.clear();
    expect([preference.id(), preference.label()]).toEqual([null, null]);
  });

  it('treats absent storage as optional', () => {
    const preference = new PersistedDevicePreference(null, ID_KEY, LABEL_KEY);
    expect([preference.id(), preference.label()]).toEqual([null, null]);
    expect(() => preference.set('port-1', 'Keyboard')).not.toThrow();
    expect(() => preference.clear()).not.toThrow();
  });

  it('contains failures when reading either value', () => {
    const preference = new PersistedDevicePreference({
      getItem: (key) => {
        if (key === ID_KEY) throw new Error('ID read blocked');
        return 'Keyboard';
      },
      setItem() {},
      removeItem() {},
    }, ID_KEY, LABEL_KEY);
    expect(preference.id()).toBeNull();
    expect(preference.label()).toBe('Keyboard');
  });

  it.each([ID_KEY, LABEL_KEY])('attempts both writes when %s write fails', (failedKey) => {
    const attempts: string[] = [];
    const values = new Map<string, string>();
    const preference = new PersistedDevicePreference({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        attempts.push(key);
        if (key === failedKey) throw new Error('write blocked');
        values.set(key, value);
      },
      removeItem() {},
    }, ID_KEY, LABEL_KEY);

    expect(() => preference.set('port-1', 'Keyboard')).not.toThrow();
    expect(attempts).toEqual([ID_KEY, LABEL_KEY]);
    expect([preference.id(), preference.label()]).toEqual([
      failedKey === ID_KEY ? null : 'port-1',
      failedKey === LABEL_KEY ? null : 'Keyboard',
    ]);
  });

  it.each([ID_KEY, LABEL_KEY])('attempts both removals when %s removal fails', (failedKey) => {
    const attempts: string[] = [];
    const values = new Map([[ID_KEY, 'port-1'], [LABEL_KEY, 'Keyboard']]);
    const preference = new PersistedDevicePreference({
      getItem: (key) => values.get(key) ?? null,
      setItem() {},
      removeItem: (key) => {
        attempts.push(key);
        if (key === failedKey) throw new Error('removal blocked');
        values.delete(key);
      },
    }, ID_KEY, LABEL_KEY);

    expect(() => preference.clear()).not.toThrow();
    expect(attempts).toEqual([ID_KEY, LABEL_KEY]);
    expect([preference.id(), preference.label()]).toEqual([
      failedKey === ID_KEY ? 'port-1' : null,
      failedKey === LABEL_KEY ? 'Keyboard' : null,
    ]);
  });
});
