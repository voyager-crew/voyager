import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import { GEMINI, byId, click, container, en, local, mount, sync } from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const AI_STUDIO = {
  ...GEMINI,
  pageUrl: 'https://aistudio.google.com/prompts/new_chat',
  siteId: 'aistudio',
};
const chip = (id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-row="${id}"] button.chip`);
/** The items of the open chip menu (every row's menu stays in the document, hidden). */
const item = (label: string) =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[role="menu"]:not([hidden]) [role="menuitemradio"]'),
  ).find((entry) => entry.textContent === label) ?? null;
const selectionSwitch = (id: string) => {
  const more = container.querySelector(`[data-row="${id}"] button.more`)!;
  return byId(more.getAttribute('aria-controls')!)!.querySelector<HTMLButtonElement>(
    `[role="switch"][aria-label="${en.formulaCopySelectionLatex}"]`,
  );
};

describe('formula copy in the floating panel', () => {
  it.each([
    ['Gemini', OFFICIAL_PLUGIN_IDS.geminiFormulaCopy, GEMINI],
    ['AI Studio', OFFICIAL_PLUGIN_IDS.aistudioFormulaCopy, AI_STUDIO],
  ] as const)(
    'on %s offers the shared format and selection conversion and writes their sync keys',
    async (_site, id, context) => {
      sync[StorageKeys.FORMULA_COPY_FORMAT] = 'unicodemath';
      await mount(context);
      expect(chip(id)!.getAttribute('aria-label')).toBe(
        `${en.formulaCopyFormat}: ${en.formulaCopyFormatUnicodeMath}`,
      );
      await click(chip(id));
      await click(item(en.formulaCopyFormatNotion));
      expect(sync[StorageKeys.FORMULA_COPY_FORMAT]).toBe('notion');

      await click(container.querySelector(`[data-row="${id}"] button.more`));
      expect(selectionSwitch(id)!.getAttribute('aria-checked')).toBe('true');
      await click(selectionSwitch(id));
      expect(sync[StorageKeys.FORMULA_COPY_SELECTION_LATEX]).toBe(false);
      expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();
    },
  );
});
