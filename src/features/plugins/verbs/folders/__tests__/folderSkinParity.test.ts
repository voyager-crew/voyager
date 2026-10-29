import type { JSDOM } from 'jsdom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { GoogleDriveSyncPayloads } from '@/core/services/GoogleDriveSyncPayloads';
import { noDriveHistory } from '@/core/services/__tests__/fixtures/noDriveHistory';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { HostCatalogSource } from '@/features/plugins/remote/HostCatalogSource';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';
import type { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { siteAdapterToData } from '@/features/plugins/sites/siteAdapterData';
import { FLOATING_PANEL_CSS } from '@/pages/content/folder/floatingPanelCss';
import { POPOVER_LAYER_HOST_CSS } from '@/pages/content/folder/floatingTree/popoverLayer';
import { FOLDER_HEADER_CSS } from '@/pages/content/folder/folderHeader/folderHeader';
import { ACTIVITY_LIST_CSS } from '@/pages/content/folder/sidebarActivityList';
import { settle } from '@/tests/memoryStorage';
import { initI18n } from '@/utils/i18n';

import { siteSectionCss } from '../sectionCss';
import { nextPass } from './claudeHarness';
import {
  SKIN_SITES,
  cssOutput,
  installSkinStorage,
  legacySkinCss,
  mountedSkinCss,
  mountedSkinSection,
  startSkinHost,
} from './folderSkinHarness';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id', getURL: (path: string) => path },
    i18n: { getUILanguage: () => 'en' },
  },
}));

declare const jsdom: JSDOM;
const hosts: PluginHost[] = [];

beforeAll(async () => {
  SKIN_SITES[0].install();
  await initI18n();
  SKIN_SITES[0].restore();
});

afterEach(async () => {
  for (const host of hosts.splice(0)) host.stop();
  await nextPass();
  for (const site of SKIN_SITES) site.restore();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-gv-scheme');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(SKIN_SITES)('$id folder appearance through PluginHost', (site) => {
  it('mounts the pre-migration CSS for both schemes, including the body-level menu, and tears it down', async () => {
    jsdom.reconfigure({ url: site.origin });
    installSkinStorage(site);
    site.mount();
    const host = await startSkinHost();
    hosts.push(host);
    const section = mountedSkinSection(site);
    // These shared sheets remain production inputs. Only the trailing skin changed;
    // the golden keeps every selector and state of its original generated output.
    const baseline =
      `${FLOATING_PANEL_CSS}\n${FOLDER_HEADER_CSS}\n${ACTIVITY_LIST_CSS}\n` +
      `${siteSectionCss(section.className)}\n${legacySkinCss(site)}`;
    const expected = cssOutput(baseline);
    expect(expected.length).toBeGreaterThan(0);
    for (const scheme of ['light', 'dark'] as const) {
      document.documentElement.setAttribute('data-gv-scheme', scheme);
      await settle(5);
      expect(section.getAttribute('data-gv-scheme')).toBe(scheme);
      expect(cssOutput(mountedSkinCss(section))).toEqual(expected);
      section
        .shadowRoot!.querySelector('.gv-floating-folder-panel__folder-header')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
      await settle(5);
      const popover = document.querySelector<HTMLElement>('.gv-folder-tree-popover-layer');
      expect(popover?.getAttribute('data-gv-scheme')).toBe(scheme);
      expect(cssOutput(mountedSkinCss(popover!))).toEqual(
        cssOutput(`${baseline}\n${POPOVER_LAYER_HOST_CSS}`),
      );
    }
    host.stop();
    await nextPass();
    expect(document.querySelector(`.gv-${site.id}-folder-section`)).toBeNull();
    expect(document.querySelector('.gv-folder-tree-popover-layer')).toBeNull();
    document.documentElement.setAttribute('data-gv-scheme', 'light');
    await settle(5);
    expect(section.getAttribute('data-gv-scheme')).toBe('dark');
  });

  it('preserves stored folders and real Drive upload payloads across leaving the page and returning', async () => {
    jsdom.reconfigure({ url: site.origin });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T00:00:00.000Z'));
    const { memory, data } = installSkinStorage(site);
    const uploads: unknown[] = [];
    const payloads = new GoogleDriveSyncPayloads({
      ...noDriveHistory,
      ensure: async (_token, name) => name,
      find: async () => null,
      upload: async (_token, name, payload) => {
        uploads.push({ name, payload: JSON.stringify(payload) });
      },
      download: async () => null,
      prepareDownload: async () => {},
    });
    const upload = () =>
      payloads.uploadPlan(
        'test',
        payloads.planUpload({
          folders: memory.values.local.get(site.key) as typeof data,
          platform: site.id,
          prompts: [],
          settings: null,
          plugins: null,
          starred: null,
          forks: null,
          timelineHierarchy: null,
          accountScope: null,
          timelineHierarchyAccountScope: null,
        }),
      );
    await upload();
    site.mount();
    const first = await startSkinHost();
    hosts.push(first);
    const css = cssOutput(mountedSkinCss(mountedSkinSection(site)));
    first.stop();
    await nextPass();
    document.body.replaceChildren();
    jsdom.reconfigure({ url: 'https://signed-out.test/' });
    expect(memory.values.local.get(site.key)).toEqual(data);

    jsdom.reconfigure({ url: site.origin });
    site.mount();
    const returned = await startSkinHost();
    hosts.push(returned);
    expect(cssOutput(mountedSkinCss(mountedSkinSection(site)))).toEqual(css);
    expect(memory.values.local.get(site.key)).toEqual(data);
    await upload();
    expect(uploads).toHaveLength(2);
    expect(uploads[1]).toEqual(uploads[0]);
  });

  it('keeps the skin when switching conversations and highlights the new open chat', async () => {
    jsdom.reconfigure({ url: `${site.origin}${site.path(site.chats[0].id)}` });
    installSkinStorage(site);
    site.mount();
    hosts.push(await startSkinHost());
    const section = mountedSkinSection(site);
    const css = cssOutput(mountedSkinCss(section));
    const row = () =>
      section
        .shadowRoot!.querySelector('.gv-floating-folder-panel__conv--active')
        ?.getAttribute('data-conversation-id');
    expect(row()).toBe(`${site.id}:conv:${site.chats[0].id}`);
    history.pushState(null, '', site.path(site.chats[1].id));
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settle(20);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await settle(20);
    // The second chat need not be filed. The old row must stop claiming to be open.
    expect(row()).not.toBe(`${site.id}:conv:${site.chats[0].id}`);
    expect(mountedSkinSection(site)).toBe(section);
    expect(cssOutput(mountedSkinCss(section))).toEqual(css);
  });

  it('updates a running skin from online data and restores bundled CSS after rejection or fetch failure', async () => {
    jsdom.reconfigure({ url: site.origin });
    const { memory } = installSkinStorage(site);
    site.mount();
    const key = hostCatalogStorageKey(new URL(site.origin).hostname);
    const bundled = requireBundledSiteAdapter(site.id);
    const skin = bundled.folderSkin!;
    const entry = (folderSkin: unknown, status = 'ok') => ({
      host: new URL(site.origin).hostname,
      status,
      manifests: [],
      fetchedAt: 1,
      lastAttemptAt: 1,
      failureCount: 0,
      extensionVersion: 'test',
      site: {
        ...siteAdapterToData(bundled),
        catalogRevision: (bundled.catalogRevision ?? 0) + 1,
        folderSkin,
      },
    });
    await memory.api.local.set({ [key]: entry(skin) });
    hosts.push(
      await startSkinHost([new HostCatalogSource({ enabled: true, extensionVersion: 'test' })]),
    );
    const original = cssOutput(mountedSkinCss(mountedSkinSection(site)));
    const update = async (value: unknown) => {
      await memory.api.local.set({ [key]: value });
      await settle(30);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await settle(30);
    };
    await update(entry({ ...skin, rowHeight: '48px' }));
    expect(mountedSkinCss(mountedSkinSection(site))).toContain('__row-height: 48px;');
    await update(entry({ ...skin, light: { ...skin.light, text: '#fff;display:none' } }));
    expect(cssOutput(mountedSkinCss(mountedSkinSection(site)))).toEqual(original);
    await update(entry({ ...skin, rowHeight: '48px' }));
    expect(mountedSkinCss(mountedSkinSection(site))).toContain('__row-height: 48px;');
    await update(entry(undefined, 'unknown'));
    expect(cssOutput(mountedSkinCss(mountedSkinSection(site)))).toEqual(original);
  });
});
