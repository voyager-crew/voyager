/**
 * The Voyager panel among Voyager's other floating panels: opening one closes
 * the others, also when nothing on the page was pressed (⌥V, the keyboard).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PANEL_MESSAGE } from '@/features/panel/protocol';

import { announceSurfaceOpened } from '../../floatingSurfaces';
import { startPromptManager } from '../../prompt/index';
import { resolvePromptSiteAdapter } from '../../prompt/resolvePromptSiteAdapter';
import {
  type ShellPage,
  ball,
  bootstrapI18n,
  flush,
  installShellPage,
  panel,
  pressAltV,
} from './shellHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./forgedEvents'));

let page: ShellPage;
let manager: { destroy: () => void } | undefined;

beforeAll(bootstrapI18n);

afterEach(async () => {
  manager?.destroy();
  manager = undefined;
  await page.restore();
  vi.restoreAllMocks();
});

async function geminiWithPromptManager(): Promise<void> {
  page = installShellPage('https://gemini.google.com/app');
  await page.start();
  manager = await startPromptManager(resolvePromptSiteAdapter(location.href));
  await flush();
}

function promptManagerOpen(): boolean {
  return document.querySelector('#gv-pm-panel')?.classList.contains('gv-hidden') === false;
}

describe('floating surfaces', () => {
  it("closes Prompt Manager's panel when ⌥V opens the Voyager panel", async () => {
    await geminiWithPromptManager();
    ball()!.click();
    expect(promptManagerOpen()).toBe(true);

    pressAltV(document.body);
    await flush();

    expect(panel()).not.toBeNull();
    expect(promptManagerOpen()).toBe(false);
  });

  it("closes the Voyager panel when Prompt Manager's panel opens from the keyboard", async () => {
    await geminiWithPromptManager();
    pressAltV(document.body);
    await flush();
    expect(panel()).not.toBeNull();

    // Enter on the focused ball: a click with no press on the page.
    ball()!.click();
    await flush();

    expect(promptManagerOpen()).toBe(true);
    expect(panel()).toBeNull();
    expect(page.sentOfType(PANEL_MESSAGE.close)).toHaveLength(1);
  });

  it('closes the Voyager panel when the Research Pack opens', async () => {
    await geminiWithPromptManager();
    pressAltV(document.body);
    await flush();

    announceSurfaceOpened('research-pack');
    await flush();

    expect(panel()).toBeNull();
  });
});
