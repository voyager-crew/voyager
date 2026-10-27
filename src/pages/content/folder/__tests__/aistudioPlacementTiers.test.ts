// @vitest-environment-options { "url": "https://aistudio.google.com/library" }
import { afterEach, expect, it } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { insertFolderPanel } from '@/features/plugins/verbs/folders/aistudio/panel';

import { readAIStudioHistoryRoot } from '../aistudioNavigationReads';

const stops: Array<() => void> = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
});
const cases = [
  {
    key: 'navigation.sidebar',
    dom: '<aside class="nav-content v3-left-nav" id="baseline"><nav></nav></aside><aside id="target"><nav></nav></aside>',
  },
  {
    key: 'navigation.navChild',
    dom: '<aside class="nav-content v3-left-nav"><nav id="baseline"></nav><section id="target"></section></aside>',
  },
  {
    key: 'navigation.historyRoot',
    dom: '<aside><section id="baseline"><ms-prompt-history-v3></ms-prompt-history-v3></section><section id="new-wrapper"><section id="target"></section></section></aside>',
  },
  {
    key: 'navigation.anchorSteps',
    dom: '<aside class="nav-content v3-left-nav"><nav><span class="empty-space" id="baseline"></span><section id="target"></section></nav></aside>',
  },
  {
    key: 'navigation.empty',
    dom: '<aside class="nav-content v3-left-nav"><nav><span class="empty-space" id="baseline"></span><section id="target"></section></nav></aside>',
  },
  {
    key: 'navigation.bottom',
    dom: '<aside class="nav-content v3-left-nav"><nav><span class="bottom-actions" id="baseline"></span><section id="target"></section></nav></aside>',
  },
];
it.each(cases)(
  '$key moves the folder panel and falls back for missing or editable slots',
  async ({ key, dom }) => {
    document.body.innerHTML = dom;
    const mount = () => {
      const panel = document.createElement('section');
      panel.className = 'gv-folder-container';
      expect(insertFolderPanel(panel, readAIStudioHistoryRoot(), '.nav-content.v3-left-nav')).toBe(
        true,
      );
      const position = `${panel.parentElement?.id}/${panel.parentElement?.parentElement?.id}/${panel.nextElementSibling?.id}`;
      panel.remove();
      return position;
    };
    const patch = async (value: string) => {
      const run = initializeSiteSelectors('aistudio', {
        host: 'aistudio.google.com',
        doc: document,
        lifetime: new AbortController().signal,
        bundledRevision: 0,
        read: async () => ({ id: 'aistudio', catalogRevision: 1, locators: { [key]: [value] } }),
      });
      stops.push(run.stop);
      await run.ready;
    };
    const original = mount();
    await patch('#target');
    const moved = mount();
    expect(moved).not.toBe(original);
    await patch('.missing');
    expect(mount()).toBe(original);
    await patch('#target');
    document.getElementById('target')!.contentEditable = 'true';
    document.getElementById('target')!.setAttribute('contenteditable', 'true');
    expect(mount()).toBe(original);
    document.getElementById('target')!.removeAttribute('contenteditable');
    expect(mount()).toBe(moved);
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
      const target = document.getElementById('target')!;
      const forbidden = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) forbidden.setAttribute(name, value);
      target.before(forbidden);
      forbidden.append(target);
      expect(mount()).toBe(original);
      forbidden.replaceWith(target);
    }
  },
);
