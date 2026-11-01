// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chat.deepseek.com/" }
/**
 * DeepSeek's folders through the page's own path: `PluginHost`, the bundled
 * catalog plugin and DeepSeek's `site.json` (`deepseekHarness.ts`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { deepseekAdapter } from '@/features/plugins/sites/adapters/deepseek';
import { SiteFolderStore } from '@/pages/content/folder/SiteFolderStore';
import { fakeTransfer } from '@/pages/content/folder/floatingTree/__tests__/treeDriver';
import { settle } from '@/tests/memoryStorage';
import { getTranslationSyncUnsafe as t, initI18n } from '@/utils/i18n';

import { siteFoldersFromData } from '../siteData';
import {
  DATA,
  FAB,
  FILED_ATTRIBUTE,
  type Page,
  ROWS,
  SECTION,
  installStorage,
  mountSidebar,
  nextPass,
  openPage,
  restoreStorage,
} from './deepseekHarness';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id', getURL: (path: string) => path },
    i18n: { getUILanguage: () => 'en' },
  },
}));

const [FILED, TARGET] = ROWS;
let page: Page | null = null;

const section = (): HTMLElement => {
  const found = document.querySelectorAll<HTMLElement>(SECTION);
  expect(found).toHaveLength(1);
  return found[0];
};
const rowLink = (id: string) => document.querySelector<HTMLElement>(`.list a[href$="${id}"]`)!;
const shown = (id: string) => getComputedStyle(rowLink(id)).display !== 'none';

function dragEvent(type: string, transfer: ReturnType<typeof fakeTransfer>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperties(event, { dataTransfer: { value: transfer }, clientY: { value: 10 } });
  return event;
}

function dropOnFolder(transfer: ReturnType<typeof fakeTransfer>): Event {
  const folder = section().shadowRoot!.querySelector<HTMLElement>(
    '.gv-floating-folder-panel__folder-header',
  )!;
  const over = dragEvent('dragover', transfer);
  folder.dispatchEvent(over);
  folder.dispatchEvent(dragEvent('drop', transfer));
  return over;
}

async function open(enabled = true, settings?: Record<string, boolean>): Promise<Page> {
  page = await openPage(installStorage(enabled, settings));
  await nextPass();
  return page;
}

beforeAll(async () => {
  installStorage(false);
  await initI18n();
  restoreStorage();
});

beforeEach(() => {
  history.replaceState(null, '', '/');
  document.title = 'DeepSeek - Into the Unknown';
});

afterEach(async () => {
  await page?.close();
  page = null;
  document.body.replaceChildren();
  restoreStorage();
  vi.restoreAllMocks();
});

describe('DeepSeek folders', () => {
  it('loads the folders an earlier build stored, unchanged, before the sidebar renders', async () => {
    const { memory } = await open();

    expect(document.querySelector(SECTION)).toBeNull();
    expect(document.querySelector(FAB)).not.toBeNull();
    expect(memory.values.local.get(StorageKeys.FOLDER_DATA_DEEPSEEK)).toEqual(DATA);
    expect(memory.writes.filter((write) => write.key === StorageKeys.FOLDER_DATA_DEEPSEEK)).toEqual(
      [],
    );
  });

  it('sits at the top of the history scroll area and takes the titles its rows show', async () => {
    const { list } = mountSidebar();
    const { stored } = await open();
    await settle(20);

    expect(section().nextElementSibling).toBe(list);
    expect(section().parentElement?.classList.contains('inner')).toBe(true);
    expect(stored().folderContents.f1?.[0]?.title).toBe(FILED.title);
    expect(document.querySelector(FAB)).toBeNull();
  });

  it('leaves the row actions out while renaming, then restores them on cancel', async () => {
    mountSidebar();
    const { stored } = await open();
    const row = section().shadowRoot!.querySelector<HTMLElement>('[data-folder-id="f1"]')!;
    const button = (key: string) =>
      row.querySelector<HTMLButtonElement>(`button[aria-label="${t(key)}"]`);

    expect(button('floatingPanelCreateSubfolder')).not.toBeNull();
    expect(button('folder_settings')).not.toBeNull();
    row.querySelector('[dir="auto"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await nextPass();

    expect(button('floatingPanelCreateSubfolder')).toBeNull();
    expect(button('folder_settings')).toBeNull();
    expect(button('floatingPanelSave')).not.toBeNull();
    button('floatingPanelCancel')!.click();
    await nextPass();

    expect(button('floatingPanelCreateSubfolder')).not.toBeNull();
    expect(button('folder_settings')).not.toBeNull();
    expect(stored().folders[0].name).toBe('Work');
  });

  it('files a row dragged from the history onto a folder', async () => {
    mountSidebar();
    const { stored } = await open();

    const transfer = fakeTransfer({ 'text/uri-list': 'https://chat.deepseek.com/' });
    rowLink(TARGET.id).querySelector('.title')!.dispatchEvent(dragEvent('dragstart', transfer));
    expect(dropOnFolder(transfer).defaultPrevented).toBe(true);
    await nextPass();

    expect(stored().folderContents.f1.map((entry) => entry.conversationId)).toContain(
      `deepseek:conv:${TARGET.id}`,
    );
  });

  it("files nothing from another page's drag that only looks like one", async () => {
    mountSidebar();
    const { stored } = await open();

    dropOnFolder(
      fakeTransfer({
        'application/json': JSON.stringify({
          type: 'conversation',
          conversationId: `deepseek:conv:${TARGET.id}`,
          title: 'Spoofed',
          url: `https://evil.example/a/chat/s/${TARGET.id}`,
        }),
      }),
    );
    await nextPass();

    expect(stored().folderContents.f1).toHaveLength(1);
  });

  it('hides filed rows from the history, and shows them again at once when turned off', async () => {
    mountSidebar();
    const { setPlugin } = await open(true, { hideFiledChats: true });
    const placed = section();

    expect(shown(FILED.id)).toBe(false);
    expect(shown(TARGET.id)).toBe(true);
    // A link in a reply is never marked, so it is never hidden.
    expect(document.querySelector(`.ds-virtual-list [${FILED_ATTRIBUTE}]`)).toBeNull();

    await setPlugin(true, { hideFiledChats: false });
    await nextPass();

    expect(shown(FILED.id)).toBe(true);
    expect(document.querySelector(`[${FILED_ATTRIBUTE}]`)).toBeNull();
    // Applied in place: the folders were not torn down and loaded again.
    expect(section()).toBe(placed);
  });

  it('hides filed rows again when hiding is turned off and back on in one page', async () => {
    mountSidebar();
    const { setPlugin } = await open(true, { hideFiledChats: true });
    expect(shown(FILED.id)).toBe(false);

    await setPlugin(true, { hideFiledChats: false });
    await nextPass();
    expect(shown(FILED.id)).toBe(true);

    await setPlugin(true, { hideFiledChats: true });
    await nextPass();
    expect(shown(FILED.id)).toBe(false);
    expect(shown(TARGET.id)).toBe(true);
  });

  it('hides filed rows when hiding is first turned on without a reload', async () => {
    mountSidebar();
    const { setPlugin } = await open(true);
    expect(shown(FILED.id)).toBe(true);

    await setPlugin(true, { hideFiledChats: true });
    await nextPass();
    expect(shown(FILED.id)).toBe(false);
    expect(shown(TARGET.id)).toBe(true);
  });

  it('hides filed rows when hiding is turned on in a tab that draws no frames', async () => {
    mountSidebar();
    const { setPlugin } = await open(true);
    // A hidden or covered tab runs no animation frames, but storage changes still arrive.
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    try {
      await setPlugin(true, { hideFiledChats: true });
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shown(FILED.id)).toBe(false);
      expect(shown(TARGET.id)).toBe(true);
    } finally {
      frames.mockRestore();
    }
  });

  it('hides filed rows when hiding is turned on while the folders cannot be edited', async () => {
    mountSidebar();
    const { setPlugin } = await open(true);
    // Edits wait while another build or tab holds the folders; filed chats are still known.
    vi.spyOn(SiteFolderStore.prototype, 'ready', 'get').mockReturnValue(false);
    await setPlugin(true, { hideFiledChats: true });
    await nextPass();

    expect(shown(FILED.id)).toBe(false);
    expect(shown(TARGET.id)).toBe(true);
  });

  it("opens a filed chat through DeepSeek's own sidebar link, without a full load", async () => {
    mountSidebar();
    await open();
    const clicks: string[] = [];
    rowLink(FILED.id).addEventListener('click', (event) => {
      event.preventDefault();
      clicks.push((event.currentTarget as HTMLAnchorElement).getAttribute('href')!);
    });

    const title = section().shadowRoot!.querySelector<HTMLAnchorElement>(
      'a.gv-floating-folder-panel__conv-title',
    )!;
    expect(title.getAttribute('href')).toBe(`https://chat.deepseek.com/a/chat/s/${FILED.id}`);
    title.click();

    expect(clicks).toEqual([`/a/chat/s/${FILED.id}`]);
    expect(location.pathname).toBe('/');
  });

  it('finds no sidebar from a link inside a reply alone', () => {
    document.body.innerHTML = `<div class="ds-virtual-list ds-scroll-area"><a href="/a/chat/s/${TARGET.id}">x</a></div>`;
    expect(siteFoldersFromData(deepseekAdapter)?.sidebar.find()).toBeNull();
  });

  it.each([
    ['its sidebar row', 'Plans - DeepSeek', TARGET.title],
    ['the tab title when the row is not listed', 'Trip ideas - DeepSeek', 'Trip ideas'],
    ['the untitled name on the home title', 'DeepSeek - Into the Unknown', 'Untitled'],
    ['the untitled name on a localized home title', 'DeepSeek - 探索未至之境', 'Untitled'],
    ['the untitled name on a placeholder', 'New chat - DeepSeek', 'Untitled'],
  ])('files the open chat under %s', (_name, tabTitle, expected) => {
    if (expected === TARGET.title) mountSidebar();
    const site = siteFoldersFromData(deepseekAdapter)!;
    document.title = tabTitle;
    history.replaceState(null, '', `/a/chat/s/${TARGET.id}`);
    expect(site.page.current('Untitled')?.title).toBe(expected);
    history.replaceState(null, '', '/');
    expect(site.page.current('Untitled')).toBeNull();
  });
});
