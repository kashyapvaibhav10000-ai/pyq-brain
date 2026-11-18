import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');

// Token check: every text/background pair the design system uses must pass WCAG AA (4.5:1), in both themes.

function tokens(block: string) {
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}
const light = tokens(css.slice(css.indexOf(':root{'), css.indexOf('/* ---------- 3.')));
const darkBlock = css.slice(css.indexOf('/* ---------- 3.'), css.indexOf('/* ---------- 4.'));
const dark = { ...light, ...tokens(darkBlock) };

function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const PAIRS: [string, string][] = [
  ['ink', 'paper'], ['ink', 'slip'], ['pencil', 'paper'], ['pencil', 'slip'], ['you', 'paper'], ['you', 'slip'],
  ['red', 'paper'], ['red', 'slip'], ['green', 'paper'], ['green', 'slip'],
  ['on-marker', 'marker'], ['on-select', 'hi'], ['on-red', 'red'],
  ['ink', 'sticky-yellow'], ['ink', 'sticky-pink'], ['ink', 'sticky-blue'], ['ink', 'sticky-green'], ['ink', 'sticky-orange'],
];

describe('design tokens', () => {
  for (const [name, t] of [['light', light], ['dark', dark]] as const)
    it(`${name} theme: text pairs pass AA`, () => {
      const fails = PAIRS.map(([fg, bg]) => [fg, bg, ratio(t[fg], t[bg])] as const).filter(([, , r]) => r < 4.5);
      expect(fails.map(([fg, bg, r]) => `${fg} on ${bg}: ${r.toFixed(2)}`)).toEqual([]);
    });
  it('generated ink block is present for every pen and seed', () => {
    for (const pen of ['ink', 'pencil', 'red']) for (const k of 'abc') expect(css).toContain(`--ink-${pen}-${k}:`);
  });
});
