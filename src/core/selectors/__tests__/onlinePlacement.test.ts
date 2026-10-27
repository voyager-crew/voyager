import type { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '../service';
import { layoutFixture, vimFixture, promptFixture } from './placementFixtures';

declare const jsdom: JSDOM;
const sites = [
  ['gemini', 'gemini.google.com'],
  ['aistudio', 'aistudio.google.com'],
  ['chatgpt', 'chatgpt.com'],
  ['claude', 'claude.ai'],
  ['deepseek', 'chat.deepseek.com'],
  ['kimi', 'www.kimi.com'],
] as const;
const keys = [
  'input.clearance',
  'input.fab',
  'vim.host',
  'vim.inputFallback',
  'vim.mountInput',
  'vim.mountRoot',
  'vim.mountChatInput',
  'vim.mountChatRoot',
  ...[
    'controls',
    'broadControls',
    'canvasOwner',
    'canvasContent',
    'fullscreenCanvas',
    'inactiveCanvas',
    'turns',
    'overlaySidebar',
    'fallbackRoot',
    'alignmentCanvas',
    'alignmentComposer',
  ].map((key) => `exportLayout.${key}`),
];
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
  describe(`${site} trusted UI placement`, () => {
    it.each(keys)(
      '%s moves Voyager UI, falls back on no match and refuses editable targets',
      async (key) => {
        jsdom.reconfigure({ url: `https://${host}/` });
        const fixture = key.startsWith('input.')
          ? promptFixture(key)
          : key.startsWith('vim.')
            ? vimFixture(key)
            : layoutFixture(key.slice('exportLayout.'.length));
        stops.push(fixture.dispose);
        const patch = async (selector: string) => {
          const run = initializeSiteSelectors(site, {
            host,
            doc: document,
            lifetime: new AbortController().signal,
            bundledRevision: 0,
            read: async () => ({ id: site, catalogRevision: 1, locators: { [key]: [selector] } }),
          });
          stops.push(run.stop);
          await run.ready;
        };
        const bundled = await fixture.measure();
        await patch(fixture.selector);
        const moved = await fixture.measure();
        expect(moved).not.toBe(bundled);
        await patch('.missing-placement');
        expect(await fixture.measure()).toBe(bundled);
        await patch(fixture.selector);
        fixture.target.setAttribute('contenteditable', 'true');
        expect(await fixture.measure()).toBe(bundled);
        fixture.target.removeAttribute('contenteditable');
        expect(await fixture.measure()).toBe(moved);
        if (!key.startsWith('vim.')) return;
        for (const [tag, attributes] of [
          ['a', { href: '/another-chat' }],
          ['div', { role: 'button' }],
          ['div', { role: 'link' }],
          ['div', { role: 'menuitem' }],
          ['div', { role: 'tab' }],
          ['div', { role: 'option' }],
          ['summary', {}],
          ['label', {}],
          ['select', {}],
          ['pre', {}],
          ['code', {}],
        ] as const) {
          const target = fixture.target;
          const forbidden = document.createElement(tag);
          for (const [name, value] of Object.entries(attributes))
            forbidden.setAttribute(name, value);
          target.before(forbidden);
          forbidden.append(target);
          expect(await fixture.measure()).toBe(bundled);
          forbidden.replaceWith(target);
        }
      },
    );
  });
