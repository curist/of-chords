// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  // happy-dom lacks the browser's Option constructor.
  vi.stubGlobal('Option', function Option(label: string, value: string) {
    const option = document.createElement('option');
    option.textContent = label;
    option.value = value;
    return option;
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function observeResources() {
  const { WebMidiOutputManager } = await import('./midi/midi-output');
  const { WebMidiInputManager } = await import('./midi/midi-input');
  const { App } = await import('./ui/app');
  const { InstrumentStore } = await import('./state/store');
  const { KeyboardInput } = await import('./input/keyboard');
  const { GamepadInput } = await import('./input/gamepad');
  const lifecycle = await import('./output/destination-lifecycle');
  const order: string[] = [];
  for (const [name, prototype] of [
    ['midi', WebMidiOutputManager.prototype],
    ['midiInput', WebMidiInputManager.prototype],
    ['App', App.prototype],
  ] as const) {
    const original = prototype.dispose;
    vi.spyOn(prototype, 'dispose').mockImplementation(function (this: typeof prototype) {
      order.push(name);
      original.call(this);
    });
  }
  const bind = lifecycle.bindDestinationLifecycle;
  vi.spyOn(lifecycle, 'bindDestinationLifecycle').mockImplementation((...args) => {
    const cleanup = bind(...args);
    return () => { order.push('destination'); cleanup(); };
  });
  for (const [name, prototype] of [['keyboard', KeyboardInput.prototype], ['gamepad', GamepadInput.prototype]] as const) {
    const attach = prototype.attach;
    vi.spyOn(prototype, 'attach').mockImplementation(function (this: typeof prototype) {
      const detach = attach.call(this);
      return () => { order.push(name); detach(); };
    });
  }
  const dispatch = InstrumentStore.prototype.dispatch;
  vi.spyOn(InstrumentStore.prototype, 'dispatch').mockImplementation(function (this: InstanceType<typeof InstrumentStore>, action) {
    if (action.type === 'panic') order.push('panic');
    dispatch.call(this, action);
  });
  return { order, InstrumentStore, GamepadInput };
}

describe('application composition lifecycle', () => {
  it('panics before disposing resources in reverse construction order exactly once', async () => {
    const { order } = await observeResources();
    await import('./main');

    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    window.dispatchEvent(new Event('blur'));

    expect(order).toEqual(['panic', 'gamepad', 'keyboard', 'App', 'destination', 'midiInput', 'midi']);
    expect(cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('unwinds managers and bindings when App construction fails', async () => {
    const { order, InstrumentStore } = await observeResources();
    vi.spyOn(InstrumentStore.prototype, 'subscribe').mockImplementation(() => { throw new Error('view failed'); });

    await expect(import('./main')).rejects.toThrow('view failed');

    expect(order).toEqual(['panic', 'destination', 'midiInput', 'midi']);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('unwinds completed App and input resources when a later attachment fails', async () => {
    const { order, GamepadInput } = await observeResources();
    vi.spyOn(GamepadInput.prototype, 'attach').mockImplementation(() => { throw new Error('attachment failed'); });

    await expect(import('./main')).rejects.toThrow('attachment failed');

    expect(order).toEqual(['panic', 'keyboard', 'App', 'destination', 'midiInput', 'midi']);
  });
});
