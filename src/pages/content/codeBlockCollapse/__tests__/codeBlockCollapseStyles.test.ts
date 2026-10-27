import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { iconButtonCss } from '@/features/plugins/verbs/iconButton';

const css = readFileSync(
  resolve(__dirname, '../../../../styles/contentStyle/380-code-block-sticky-bar.css'),
  'utf8',
);
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  (match) => ({ selector: match[1].trim(), declarations: match[2] }),
);
let sheet: HTMLStyleElement | undefined;

afterEach(() => {
  sheet?.remove();
  sheet = undefined;
  document.body.replaceChildren();
});

it('renamed code hosts retain every collapse style, including fade and toggle states', () => {
  const selectors = rules
    .map(({ selector }) => selector)
    .filter((selector) => selector.includes('.gv-code-block-'));

  expect(selectors.length).toBeGreaterThan(0);
  // These classes belong to Voyager; a native tag rename cannot disable their packaged CSS.
  expect(
    selectors.filter((selector) => /(^|[\s,(>+~])code-block(?=[\s.#[:>+~,]|$)/.test(selector)),
  ).toEqual([]);
});

it('renamed code hosts keep the same clipping, non-sticky header and toggle styles as packaged hosts', () => {
  sheet = document.createElement('style');
  sheet.textContent = css;
  document.head.append(sheet);
  for (const tag of ['code-block', 'code-block-v2']) {
    const host = document.createElement(tag);
    host.className = 'gv-code-block-collapsible';
    host.innerHTML = `<div class="code-block"><div class="formatted-code-block-internal-container">
      <div class="code-block-decoration"><button class="gv-code-block-toggle"><svg></svg></button></div>
      <pre><code>Long code</code></pre></div></div>`;
    document.body.append(host);
    const container = host.querySelector<HTMLElement>('.formatted-code-block-internal-container')!;
    const header = host.querySelector<HTMLElement>('.code-block-decoration')!;
    const toggle = host.querySelector<HTMLButtonElement>('button')!;
    // jsdom drops clamp() in max-height, so check applicability of the shipped height rule directly.
    const heightRules = rules.filter(({ declarations }) => declarations.includes('max-height:'));
    const isClipped = () => heightRules.some(({ selector }) => container.matches(selector));

    expect(isClipped()).toBe(false);
    expect(getComputedStyle(header).position).toBe('static');
    expect(getComputedStyle(header).top).toBe('auto');
    expect(getComputedStyle(toggle).display).toBe('inline-flex');
    expect(getComputedStyle(toggle).width).toBe('32px');
    expect(getComputedStyle(toggle.querySelector('svg')!).width).toBe('20px');

    host.classList.add('gv-code-block-collapsed');
    expect(isClipped()).toBe(true);
    expect(getComputedStyle(container).overflow).toBe('hidden');
    expect(getComputedStyle(container).position).toBe('relative');

    host.classList.remove('gv-code-block-collapsed');
    expect(isClipped()).toBe(false);
  }
});

it('Gemini collapse styles do not resize other sites shared collapse buttons', () => {
  sheet = document.createElement('style');
  sheet.textContent = iconButtonCss('.gv-code-block-toggle') + css;
  document.head.append(sheet);
  const host = document.createElement('pre');
  host.className = 'gv-code-block-collapsible gv-code-block-collapsed';
  host.innerHTML =
    '<button class="gv-code-block-toggle"><svg></svg></button><code>Long code</code>';
  document.body.append(host);
  const toggle = host.querySelector('button')!;

  expect(getComputedStyle(toggle).width).toBe('28px');
  expect(getComputedStyle(toggle).height).toBe('28px');
  expect(getComputedStyle(toggle).padding).toBe('0px');
  expect(getComputedStyle(toggle).borderRadius).toBe('8px');
  expect(getComputedStyle(toggle.querySelector('svg')!).width).toBe('16px');
});
