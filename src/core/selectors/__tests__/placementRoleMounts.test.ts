import type { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBundledSiteSelectorView } from '../bundle';
import { resolvePlacementOperation } from '../placement';
import { getSiteSelectorView, initializeSiteSelectors } from '../service';
import { vimFixture } from './placementFixtures';

declare const jsdom: JSDOM;
const sites = [
  ['gemini', 'gemini.google.com'],
  ['aistudio', 'aistudio.google.com'],
  ['chatgpt', 'chatgpt.com'],
  ['claude', 'claude.ai'],
  ['deepseek', 'chat.deepseek.com'],
  ['kimi', 'www.kimi.com'],
] as const;
const stops: Array<() => void> = [];
afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

for (const [site, host] of sites)
  describe(`${site} placement roles`, () => {
    it.each(['searchbox', 'spinbutton', 'slider'])(
      'a %s ancestor cannot turn a remote Vim HUD mount into a host control',
      async (role) => {
        jsdom.reconfigure({ url: `https://${host}/` });
        const fixture = vimFixture('vim.host');
        stops.push(fixture.dispose);
        const bundled = await fixture.measure();
        const run = initializeSiteSelectors(site, {
          host,
          doc: document,
          lifetime: new AbortController().signal,
          bundledRevision: 0,
          read: async () => ({
            id: site,
            catalogRevision: 1,
            locators: { 'vim.host': [fixture.selector] },
          }),
        });
        stops.push(run.stop);
        await run.ready;
        const repaired = await fixture.measure();
        expect(repaired).not.toBe(bundled);
        fixture.target.setAttribute('role', role);
        expect(await fixture.measure()).toBe(bundled);
        fixture.target.removeAttribute('role');
        const control = document.createElement('section');
        control.setAttribute('role', role);
        fixture.target.before(control);
        control.append(fixture.target);
        expect(await fixture.measure()).toBe(bundled);
        control.replaceWith(fixture.target);
        expect(await fixture.measure()).toBe(repaired);
      },
    );

    it('editable roles refuse measurement targets while slider and scrollbar stay measurable', async () => {
      jsdom.reconfigure({ url: `https://${host}/` });
      document.body.innerHTML = '<section id="baseline"></section><section id="target"></section>';
      const run = initializeSiteSelectors(site, {
        host,
        doc: document,
        lifetime: new AbortController().signal,
        bundledRevision: 0,
        read: async () => ({
          id: site,
          catalogRevision: 1,
          locators: { 'vim.host': ['#target'] },
        }),
      });
      stops.push(run.stop);
      await run.ready;
      const target = document.getElementById('target')!;
      const baseline = document.getElementById('baseline')!;
      const read = () =>
        resolvePlacementOperation(
          getSiteSelectorView(site),
          'vim.host',
          (selector) => document.querySelector(selector),
          { mount: false, fallback: ['#baseline'] },
        );
      expect(read()).toBe(target);
      for (const role of ['searchbox', 'spinbutton']) {
        target.setAttribute('role', role);
        expect(read()).toBe(baseline);
        // Bundled reads retain the original mount and measurement behavior with updates off.
        expect(
          resolvePlacementOperation(
            getBundledSiteSelectorView(site),
            'vim.host',
            (selector) => document.querySelector(selector),
            { mount: false, fallback: ['#target'] },
          ),
        ).toBe(target);
      }
      for (const role of ['slider', 'scrollbar']) {
        target.setAttribute('role', role);
        expect(read()).toBe(target);
      }
      expect(
        resolvePlacementOperation(
          getSiteSelectorView(site),
          'vim.host',
          (selector) => document.querySelector(selector),
          { fallback: ['#baseline'] },
        ),
      ).toBe(target);
    });
  });
