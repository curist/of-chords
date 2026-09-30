// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { InstrumentStore } from '../state/store';
import { InstrumentView } from './instrument-view';

function fixture() {
  const root = document.createElement('div');
  root.innerHTML = `
    <select id="tonic-select"><option value="0">C</option><option value="7">G</option></select>
    <select id="mode-select"><option value="major">Major</option><option value="dorian">Dorian</option></select>
    <div id="shape-controls"><button data-shape="triad">Triad</button><button data-shape="seventh">7th</button></div>
    <div id="inversion-controls"><button data-inversion="0">Root</button><button data-inversion="1">1st</button></div>
    <div id="chord-grid">
      <button class="chord-pad" data-degree="1"><span class="roman"></span><strong></strong><small></small></button>
      <button class="chord-pad" data-degree="2"><span class="roman"></span><strong></strong><small></small></button>
    </div>
    <div id="currently-sounding"></div><div id="history-names"></div><div id="history-romans"></div>
    <button id="panic">Panic</button><button id="previous-program">Previous</button>
    <input id="program-input"><button id="next-program">Next</button>`;
  document.body.replaceChildren(root);
  const target = { acquire: vi.fn(), release: vi.fn(), panic: vi.fn(), programChange: vi.fn() };
  const store = new InstrumentStore(target);
  const view = new InstrumentView(root, store);
  return { root, target, store, view };
}

describe('InstrumentView', () => {
  it('renders chord pads, active chords, history, and idle copy', () => {
    const { root, store } = fixture();
    const pad = root.querySelector<HTMLButtonElement>('[data-degree="1"]')!;
    expect(pad.querySelector('.roman')?.textContent).toBe('I');
    expect(pad.querySelector('strong')?.textContent).toBe('C');
    expect(pad.querySelector('small')?.textContent).toBe('C · E · G');
    expect(pad.title).toBe('MIDI 48, 52, 55');
    expect(root.querySelector('#currently-sounding')?.textContent).toBe('Play a chord');

    store.dispatch({ type: 'press', owner: 'keyboard:a', degree: 1 });
    expect(pad.classList.contains('active')).toBe(true);
    expect(pad.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('#currently-sounding')?.textContent).toContain('C3');
    expect(root.querySelector('#history-names')?.textContent).toBe('C');
    expect(root.querySelector('#history-romans')?.textContent).toBe('I');
    store.dispatch({ type: 'release', owner: 'keyboard:a' });
    expect(root.querySelector('#currently-sounding')?.textContent).toBe('Play a chord');
  });

  it('renders literal MIDI notes as passthrough without adding chord history', () => {
    const { root, store } = fixture();
    store.dispatch({ type: 'press-note', owner: 'midi:61', note: 61, velocity: 90 });
    const current = root.querySelector('#currently-sounding')!;
    expect(current.textContent).toContain('C#4');
    expect(current.textContent?.match(/C#4/g)).toHaveLength(1);
    expect(current.textContent).toContain('MIDI 61');
    expect(current.textContent).toContain('Passthrough');
    expect(root.querySelector('#history-names')?.textContent).toBe('No chords yet');
    store.dispatch({ type: 'release', owner: 'midi:61' });
    expect(current.textContent).toBe('Play a chord');
  });

  it('commits tonic, mode, shape, inversion, and MIDI program controls', () => {
    const { root, store } = fixture();
    const tonic = root.querySelector<HTMLSelectElement>('#tonic-select')!;
    tonic.value = '7';
    tonic.dispatchEvent(new Event('change', { bubbles: true }));
    const mode = root.querySelector<HTMLSelectElement>('#mode-select')!;
    mode.value = 'dorian';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    for (const select of root.querySelectorAll('select')) {
      select.focus();
      expect(document.activeElement).toBe(select);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(document.activeElement).not.toBe(select);
    }
    root.querySelector<HTMLButtonElement>('[data-shape="seventh"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-inversion="1"]')!.click();
    expect(store.getState()).toMatchObject({ tonic: 7, mode: 'dorian', shape: 'seventh', inversion: 1 });
    expect(root.querySelector('[data-shape="seventh"]')?.classList.contains('selected')).toBe(true);
    expect(root.querySelector('[data-inversion="1"]')?.classList.contains('selected')).toBe(true);

    const program = root.querySelector<HTMLInputElement>('#program-input')!;
    program.value = '41';
    program.focus();
    program.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.getState().program).toBe(40);
    expect(document.activeElement).not.toBe(program);
    root.querySelector<HTMLButtonElement>('#next-program')!.click();
    expect(program.value).toBe('42');
    root.querySelector<HTMLButtonElement>('#previous-program')!.click();
    expect(program.value).toBe('41');
  });

  it('keeps malformed values inert', () => {
    const { root, store } = fixture();
    const dispatch = vi.spyOn(store, 'dispatch');
    const tonic = root.querySelector<HTMLSelectElement>('#tonic-select')!;
    tonic.value = '12';
    tonic.dispatchEvent(new Event('change', { bubbles: true }));
    const mode = root.querySelector<HTMLSelectElement>('#mode-select')!;
    mode.value = '__proto__';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const shape = root.querySelector<HTMLButtonElement>('[data-shape="triad"]')!;
    shape.dataset.shape = '__proto__';
    shape.click();
    const inversion = root.querySelector<HTMLButtonElement>('[data-inversion="0"]')!;
    inversion.dataset.inversion = '1.5';
    inversion.click();
    const program = root.querySelector<HTMLInputElement>('#program-input')!;
    program.value = 'Infinity';
    program.dispatchEvent(new Event('change', { bubbles: true }));
    const pad = root.querySelector<HTMLButtonElement>('[data-degree="1"]')!;
    pad.dataset.degree = '8';
    pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 }));
    pad.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not select or re-render controls whose datasets become invalid', () => {
    const { root, store } = fixture();
    const inversion = root.querySelector<HTMLButtonElement>('[data-inversion="0"]')!;
    const pad = root.querySelector<HTMLButtonElement>('[data-degree="1"]')!;
    expect(pad.querySelector('strong')?.textContent).toBe('C');
    inversion.dataset.inversion = '';
    pad.dataset.degree = '8';
    store.dispatch({ type: 'set-tonic', tonic: 7 });
    expect(inversion.classList.contains('selected')).toBe(false);
    expect(pad.querySelector('strong')?.textContent).toBe('C');
  });

  it('holds separate pointer owners and releases each on up or cancel', () => {
    const { root, store, target } = fixture();
    const first = root.querySelector<HTMLButtonElement>('[data-degree="1"]')!;
    const second = root.querySelector<HTMLButtonElement>('[data-degree="2"]')!;
    first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3 }));
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 4 }));
    expect(Object.keys(store.getState().active)).toEqual(['pointer:3', 'pointer:4']);
    first.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 }));
    expect(Object.keys(store.getState().active)).toEqual(['pointer:4']);
    second.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 4 }));
    expect(Object.keys(store.getState().active)).toEqual([]);
    expect(target.release).toHaveBeenCalledTimes(2);
  });

  it('removes pointer listeners on dispose without releasing active sound', () => {
    const { root, store, view, target } = fixture();
    const pad = root.querySelector<HTMLButtonElement>('[data-degree="1"]')!;
    pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 5 }));
    view.dispose();
    view.dispose();
    pad.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 5 }));
    expect(Object.keys(store.getState().active)).toEqual(['pointer:5']);
    expect(target.release).not.toHaveBeenCalled();
    store.dispatch({ type: 'panic' });
    expect(target.panic).toHaveBeenCalledOnce();
  });

  it('renders from cached elements without DOM queries after construction', () => {
    const { root, store } = fixture();
    const nodes = [root, ...root.querySelectorAll('*')];
    const queries = nodes.flatMap((node) => [
      vi.spyOn(node, 'querySelector'),
      vi.spyOn(node, 'querySelectorAll'),
    ]);
    store.dispatch({ type: 'set-tonic', tonic: 7 });
    for (const query of queries) {
      expect(query).not.toHaveBeenCalled();
      query.mockRestore();
    }
    expect(root.querySelector('[data-degree="1"] strong')?.textContent).toBe('G');
  });

  it('dispatches panic from its control', () => {
    const { root, target } = fixture();
    root.querySelector<HTMLButtonElement>('#panic')!.click();
    expect(target.panic).toHaveBeenCalledOnce();
  });
});
