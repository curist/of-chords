import type { OutputMode } from '../output/output-controller';

export function parseOutputMode(value: string): OutputMode | null {
  return value === 'builtin' || value === 'midi' ? value : null;
}

export function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
