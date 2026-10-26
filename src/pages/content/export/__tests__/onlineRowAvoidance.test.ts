import type { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';

import { mountPersistentExportToolbar } from '../persistentExportToolbar';
import { mockRect, nextFrame, stubElementsFromPoint } from './persistentExportToolbarHarness';

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
  Reflect.deleteProperty(document, 'elementsFromPoint');
});

it.each(sites)(
  '%s retains its packaged row-avoidance policy while repairing interactive regions',
  async (site, host) => {
    jsdom.reconfigure({ url: `https://${host}/` });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    document.body.innerHTML = '<section id="target"></section>';
    const target = document.getElementById('target')!;
    mockRect(target, { left: 1000, right: 1060, width: 60, top: 8, bottom: 44, height: 36 });
    stubElementsFromPoint((x) => (x >= 1000 && x <= 1060 ? [target] : []));
    const patch = async (selector: string) => {
      const run = initializeSiteSelectors(site, {
        host,
        doc: document,
        lifetime: new AbortController().signal,
        bundledRevision: 0,
        read: async () => ({
          id: site,
          catalogRevision: 1,
          locators: { 'exportLayout.interactive': [selector] },
        }),
      });
      stops.push(run.stop);
      await run.ready;
    };
    const measure = async () => {
      const handle = mountPersistentExportToolbar({
        label: 'Export',
        tooltip: 'Export',
        onClick: () => {},
      });
      mockRect(handle.root, {
        left: 1016,
        right: 1196,
        width: 180,
        top: 8,
        bottom: 44,
        height: 36,
      });
      await nextFrame();
      const offset = handle.root.style.getPropertyValue('--gv-persistent-export-right');
      handle.remove();
      return offset;
    };
    expect(await measure()).toBe('84px');
    await patch('#target');
    expect(await measure()).toBe(site === 'chatgpt' ? '292px' : '84px');
    await patch('.missing');
    expect(await measure()).toBe('84px');
    await patch('#target');
    target.setAttribute('contenteditable', 'true');
    expect(await measure()).toBe('84px');
    target.removeAttribute('contenteditable');
    expect(await measure()).toBe(site === 'chatgpt' ? '292px' : '84px');
  },
);
