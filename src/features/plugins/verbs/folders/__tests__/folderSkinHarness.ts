import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { BundledCatalogPluginSource } from '@/features/plugins/sources/BundledCatalogPluginSource';
import type { PluginSource } from '@/features/plugins/types';
import type { MemoryStorage } from '@/tests/memoryStorage';

import * as claude from './claudeHarness';
import * as deepseek from './deepseekHarness';

export const SKIN_SITES = [
  {
    id: 'claude',
    origin: 'https://claude.ai',
    key: StorageKeys.FOLDER_DATA_CLAUDE,
    mount: claude.mountSidebar,
    install: () => claude.installStorage(true),
    restore: claude.restoreStorage,
    chats: [claude.RECENTS[0], claude.PINNED],
    path: (id: string) => `/chat/${id}`,
  },
  {
    id: 'deepseek',
    origin: 'https://chat.deepseek.com',
    key: StorageKeys.FOLDER_DATA_DEEPSEEK,
    mount: deepseek.mountSidebar,
    install: () => deepseek.installStorage(true),
    restore: deepseek.restoreStorage,
    chats: deepseek.ROWS,
    path: (id: string) => `/a/chat/s/${id}`,
  },
] as const;

export type SkinSite = (typeof SKIN_SITES)[number];

/** Keep the old stored format, with current titles so an ordinary title repair is not an edit. */
export function installSkinStorage(site: SkinSite): { memory: MemoryStorage; data: FolderData } {
  const memory = site.install();
  const data = structuredClone(memory.values.local.get(site.key)) as FolderData;
  const first = Object.values(data.folderContents).flat()[0];
  first.title = site.chats[0].title;
  memory.values.local.set(site.key, structuredClone(data));
  return { memory, data };
}

export async function startSkinHost(sources: readonly PluginSource[] = []): Promise<PluginHost> {
  const host = new PluginHost({
    url: location.href,
    sources: [...sources, new BundledCatalogPluginSource()],
    doc: document,
    requestCatalogRefresh: () => {},
    isTopFrame: true,
  });
  await host.start();
  await claude.nextPass();
  return host;
}

export function mountedSkinSection(site: SkinSite): HTMLElement {
  const element = document.querySelector<HTMLElement>(`.gv-${site.id}-folder-section`);
  if (!element?.shadowRoot) throw new Error('Folder section did not mount');
  return element;
}

export function mountedSkinCss(element: HTMLElement): string {
  const style = element.shadowRoot?.querySelector('style');
  if (!style?.textContent) throw new Error('Folder stylesheet did not mount');
  return style.textContent;
}

/** Reviewed pre-migration output, preserved as appearance goldens rather than a copy of the tokens. */
export function legacySkinCss(site: SkinSite): string {
  return readFileSync(
    join(
      process.cwd(),
      'src/features/plugins/verbs/folders/__tests__/fixtures/folderSkins',
      `${site.id}.css`,
    ),
    'utf8',
  );
}

/** Compare generated CSS semantics, retaining rule order, selectors, values and !important. */
export function cssOutput(css: string): unknown[] {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const normalize = (value: string) =>
    value
      .replace(/\s+/g, ' ')
      .replace(/\s*([(),])\s*/g, '$1')
      .trim();
  try {
    if (!style.sheet) throw new Error('Stylesheet did not parse');
    return Array.from(style.sheet.cssRules, (rule) => {
      if (rule.type !== CSSRule.STYLE_RULE) return normalize(rule.cssText);
      const { selectorText, style: declarations } = rule as CSSStyleRule;
      const properties = Array.from({ length: declarations.length }, (_, i) => declarations[i]);
      return {
        selector: selectorText
          .replace(/\s+/g, ' ')
          .replace(/\s*,\s*/g, ',')
          .trim(),
        declarations: properties
          .sort()
          .map((property) => [
            property,
            normalize(declarations.getPropertyValue(property)),
            declarations.getPropertyPriority(property),
          ]),
      };
    });
  } finally {
    style.remove();
  }
}
