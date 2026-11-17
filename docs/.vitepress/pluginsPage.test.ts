import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../../src/features/plugins/builtin';
import { OFFICIAL_PLUGIN_IDS } from '../../src/features/plugins/sites/featureOwners';
import { resolveEffectiveEnabled } from '../../src/features/plugins/storage/legacySettingBindings';
import type { PluginManifest } from '../../src/features/plugins/types';
import {
  FRESH_INSTALL_ON,
  PLUGINS_LOCALES,
  type SitePlugin,
  builtinPlugins,
  featureRows,
  renderPluginsPage,
} from './pluginsPage';

const manifest = (id: string, name: string, matches: string[] = [], zh?: string): PluginManifest =>
  ({
    id,
    name,
    matches,
    ...(zh ? { i18n: { zh: { name: zh } } } : {}),
  }) as unknown as PluginManifest;

const locale = (code: string) => PLUGINS_LOCALES.find((entry) => entry.manifest === code)!;

const ticked = (rows: ReturnType<typeof featureRows>) =>
  rows.map((row) => [row.feature, [...Object.keys(row.plugins), ...row.native].sort()]);

/** The table's cells for the row whose name is `name`, Gemini first. */
const cells = (page: string, name: string) => {
  const line = page.split('\n').find((entry) => entry.startsWith(`| **${name}`));
  if (!line) return undefined;
  return line
    .split(' | ')
    .slice(1)
    .map((cell) => cell.replace(/ \|$/, '').trim())
    .map((cell) => (cell.includes('gv-plugins-on') ? 'on' : cell.includes('✓') ? '✓' : ''));
};

const noPages = () => false;

describe('plugin table', () => {
  it('gives a feature one row with a tick on every site that has it', () => {
    const rows = featureRows([
      { site: 'claude', feature: 'quote-reply', manifest: manifest('a', 'Claude · Quote') },
      { site: 'gemini', feature: 'quote-reply', manifest: manifest('b', 'Gemini · Quote') },
      { site: 'deepseek', feature: 'vim-input', manifest: manifest('c', 'DeepSeek · Vim') },
      { site: 'chatgpt', feature: 'input-vim', manifest: manifest('d', 'Vim') },
    ]);

    expect(ticked(rows)).toEqual([
      ['quote-reply', ['claude', 'gemini']],
      ['input-vim', ['chatgpt', 'deepseek']],
    ]);
  });

  it("folds Gemini's split plugins into the cross-site row and keeps Mermaid apart", () => {
    const rows = featureRows([
      { site: 'chatgpt', feature: 'reading-typography', manifest: manifest('a', 'Typography') },
      { site: 'gemini', feature: 'chat-font-size', manifest: manifest('b', 'Gemini · Size') },
      { site: 'gemini', feature: 'chat-line-height', manifest: manifest('c', 'Gemini · Spacing') },
      { site: 'chatgpt', feature: 'diagram-rendering', manifest: manifest('d', 'Diagrams') },
      { site: 'gemini', feature: 'echarts', manifest: manifest('e', 'Gemini · ECharts') },
      { site: 'gemini', feature: 'wavedrom', manifest: manifest('f', 'Gemini · WaveDrom') },
      { site: 'gemini', feature: 'mermaid', manifest: manifest('g', 'Gemini · Mermaid') },
    ]);

    expect(ticked(rows)).toEqual([
      ['reading-typography', ['chatgpt', 'gemini']],
      ['mermaid', ['gemini']],
      ['diagram-rendering', ['chatgpt', 'gemini']],
    ]);
  });

  it('files a builtin under every site it matches, Gemini and AI Studio included', () => {
    const plugins = builtinPlugins([
      manifest('voyager.formula-copy', 'Formula Copy', [
        'https://claude.ai/*',
        'https://chatgpt.com/*',
      ]),
      manifest('voyager.gemini-timeline', 'Gemini · Timeline', ['https://gemini.google.com/*']),
      manifest('voyager.aistudio-x', 'AI Studio · X', ['https://aistudio.google.com/*']),
    ]);

    expect(plugins.map(({ site, feature }) => `${site}:${feature}`)).toEqual([
      'chatgpt:formula-copy',
      'claude:formula-copy',
      'gemini:timeline',
      'aistudio:x',
    ]);
  });

  it('leaves out the Safari Enter fix', () => {
    const rows = featureRows([
      {
        site: 'gemini',
        feature: 'safari-enter-fix',
        manifest: manifest(OFFICIAL_PLUGIN_IDS.geminiSafariEnterFix, 'Gemini · Fix Enter'),
      },
    ]);

    expect(rows).toEqual([]);
  });

  it('ticks folders on each site whose plugin has them, on one row', () => {
    const folders = (site: SitePlugin['site'], id: string, name: string): SitePlugin => ({
      site,
      feature: 'folders',
      manifest: manifest(id, name),
    });

    expect(
      ticked(
        featureRows([
          folders('chatgpt', 'voyager.chatgpt-folders', 'ChatGPT · Folders'),
          folders('gemini', OFFICIAL_PLUGIN_IDS.geminiFolders, 'Gemini · Folders'),
          folders('aistudio', OFFICIAL_PLUGIN_IDS.aistudioFolders, 'AI Studio · Folders'),
        ]),
      ),
    ).toEqual([['folders', ['aistudio', 'chatgpt', 'gemini']]]);
    expect(featureRows([])).toEqual([]);
  });

  it("names a row from the first of ChatGPT, Claude, DeepSeek, then Gemini, in the page's language", () => {
    const plugins: SitePlugin[] = [
      {
        site: 'gemini',
        feature: 'code-collapse',
        manifest: manifest('g', 'Gemini · Code Block Collapse', [], 'Gemini · 代码块折叠'),
      },
      {
        site: 'deepseek',
        feature: 'code-collapse',
        manifest: manifest('d', 'DeepSeek · Code Folding', [], 'DeepSeek · 代码折叠'),
      },
      {
        site: 'gemini',
        feature: 'fork',
        manifest: manifest('f', 'Gemini · Conversation forks', [], 'Gemini · 对话分叉'),
      },
    ];

    const page = renderPluginsPage(locale('zh'), featureRows(plugins), new Set(), noPages);

    expect(cells(page, '代码折叠')).toEqual(['✓', '', '', '', '✓', '', '']);
    expect(cells(page, '对话分叉')).toEqual(['✓', '', '', '', '', '', '']);
    expect(page).not.toContain('代码块折叠');
  });

  it('marks on-by-default per site, not per row', () => {
    const plugins: SitePlugin[] = [
      { site: 'gemini', feature: 'timeline', manifest: manifest('g', 'Gemini · Timeline') },
      { site: 'claude', feature: 'timeline', manifest: manifest('c', 'Claude · Timeline') },
      { site: 'gemini', feature: 'echarts', manifest: manifest('e', 'Gemini · ECharts') },
      { site: 'gemini', feature: 'wavedrom', manifest: manifest('w', 'Gemini · WaveDrom') },
    ];

    const page = renderPluginsPage(
      locale('en'),
      featureRows(plugins),
      new Set(['g', 'e']),
      noPages,
    );

    expect(cells(page, 'Timeline')).toEqual(['on', '', '', '✓', '', '', '']);
    // One of Gemini's two diagram plugins is still off: the reader has to switch it on.
    expect(cells(page, 'ECharts')).toEqual(['✓', '', '', '', '', '', '']);
  });

  it("shows Gemini's export as its default-on plugin in ChatGPT's export row", () => {
    const manifests = BUILTIN_PLUGINS.filter(
      (plugin) =>
        plugin.id === OFFICIAL_PLUGIN_IDS.geminiExport || plugin.id === 'voyager.chatgpt-export',
    );
    const rows = featureRows(builtinPlugins(manifests));
    expect(ticked(rows)).toEqual([['export', ['chatgpt', 'gemini']]]);
    expect(rows[0].native).toEqual([]);
    for (const entry of PLUGINS_LOCALES) {
      const prefix = entry.prefix ? `/${entry.prefix}` : '';
      const exists = (path: string) => existsSync(resolve('docs', `.${path}.md`));
      const page = renderPluginsPage(entry, rows, FRESH_INSTALL_ON, exists);
      const chatgpt = rows[0].plugins.chatgpt![0];
      const name = (chatgpt.i18n?.[entry.manifest]?.name ?? chatgpt.name).replace(/^[^·]*·\s*/, '');
      expect(cells(page, `[${name}](${prefix}/guide/export)`)).toEqual([
        'on',
        '',
        '✓',
        '',
        '',
        '',
        '',
      ]);
    }
  });

  it("links a row to its guide page in the page's locale only where that page exists", () => {
    const plugins: SitePlugin[] = [
      { site: 'chatgpt', feature: 'timeline', manifest: manifest('t', 'ChatGPT · Timeline') },
      { site: 'claude', feature: 'ctrl-enter-send', manifest: manifest('s', 'Claude · Send') },
      { site: 'deepseek', feature: 'wrap-code', manifest: manifest('w', 'DeepSeek · Wrap') },
    ];
    const pages = new Set(['/guide/timeline', '/guide/send-behavior', '/ja/guide/send-behavior']);
    const exists = (path: string) => pages.has(path);

    const zh = renderPluginsPage(locale('zh'), featureRows(plugins), new Set(), exists);
    const ja = renderPluginsPage(locale('ja'), featureRows(plugins), new Set(), exists);

    expect(zh).toContain('| **[Timeline](/guide/timeline)** |');
    expect(zh).toContain('| **[Send](/guide/send-behavior)** |');
    expect(zh).toContain('| **Wrap** |');
    expect(ja).toContain('| **Timeline** |');
    expect(ja).toContain('| **[Send](/ja/guide/send-behavior)** |');
  });

  it('claims on-by-default for exactly the official plugins a fresh install runs', () => {
    const shown = Object.values(OFFICIAL_PLUGIN_IDS).filter(
      (id) => id !== OFFICIAL_PLUGIN_IDS.geminiSafariEnterFix,
    );

    for (const id of shown) {
      expect([id, FRESH_INSTALL_ON.has(id)]).toEqual([id, resolveEffectiveEnabled({}, {}, id)]);
    }
  });

  it.each([
    [OFFICIAL_PLUGIN_IDS.geminiDeepResearchExport, 'deep-research-export', 'deep-research'],
    [OFFICIAL_PLUGIN_IDS.geminiMarkdownFix, 'markdown-fix', 'markdown-fix'],
  ] as const)('links %s to its guide in every locale, on by default', (id, feature, guide) => {
    const manifests = BUILTIN_PLUGINS.filter((plugin) => plugin.id === id);
    const rows = featureRows(builtinPlugins(manifests));
    expect(ticked(rows)).toEqual([[feature, ['gemini']]]);
    for (const entry of PLUGINS_LOCALES) {
      const prefix = entry.prefix ? `/${entry.prefix}` : '';
      const exists = (path: string) => existsSync(resolve('docs', `.${path}.md`));
      const page = renderPluginsPage(entry, rows, FRESH_INSTALL_ON, exists);
      const plugin = manifests[0];
      const name = (plugin.i18n?.[entry.manifest]?.name ?? plugin.name).replace(/^Gemini · /, '');
      const label = `[${name}](${prefix}/guide/${guide})`;
      expect(page).toContain(`| **${label}** |`);
      expect(cells(page, label)).toEqual(['on', '', '', '', '', '', '']);
    }
  });

  it('lists Recent Gems as on by default and links it and Context Sync in all locales', () => {
    const manifests = BUILTIN_PLUGINS.filter(
      (plugin) =>
        plugin.id === OFFICIAL_PLUGIN_IDS.geminiGemsSidebar ||
        plugin.id === OFFICIAL_PLUGIN_IDS.geminiContextSync,
    );
    const rows = featureRows(builtinPlugins(manifests));
    expect(ticked(rows)).toEqual(
      expect.arrayContaining([
        ['gems-sidebar', ['gemini']],
        ['context-sync', ['gemini']],
      ]),
    );
    expect(rows).toHaveLength(2);
    for (const entry of PLUGINS_LOCALES) {
      const prefix = entry.prefix ? `/${entry.prefix}` : '';
      const exists = (path: string) => existsSync(resolve('docs', `.${path}.md`));
      const page = renderPluginsPage(entry, rows, FRESH_INSTALL_ON, exists);
      for (const row of rows) {
        const plugin = row.plugins.gemini![0];
        const name = (plugin.i18n?.[entry.manifest]?.name ?? plugin.name).replace(/^Gemini · /, '');
        const label = `[${name}](${prefix}/guide/${row.feature})`;
        expect(page).toContain(`| **${label}** |`);
        const mark = FRESH_INSTALL_ON.has(plugin.id) ? 'on' : '✓';
        expect(cells(page, label)).toEqual([mark, '', '', '', '', '', '']);
      }
    }
  });

  it('links the default-on batch delete row to every localized guide on both sites', () => {
    const manifests = BUILTIN_PLUGINS.filter(
      (plugin) =>
        plugin.id === OFFICIAL_PLUGIN_IDS.geminiBatchDelete ||
        plugin.id === OFFICIAL_PLUGIN_IDS.aistudioBatchDelete,
    );
    const rows = featureRows(builtinPlugins(manifests));
    expect(ticked(rows)).toEqual([['batch-delete', ['aistudio', 'gemini']]]);
    for (const entry of PLUGINS_LOCALES) {
      const prefix = entry.prefix ? `/${entry.prefix}` : '';
      const exists = (path: string) => existsSync(resolve('docs', `.${path}.md`));
      const page = renderPluginsPage(entry, rows, FRESH_INSTALL_ON, exists);
      const plugin = rows[0].plugins.gemini![0];
      const name = (plugin.i18n?.[entry.manifest]?.name ?? plugin.name).replace(/^Gemini · /, '');
      const label = `[${name}](${prefix}/guide/batch-delete)`;
      expect(cells(page, label)).toEqual(['on', 'on', '', '', '', '', '']);
    }
  });

  it('shows sidebar width on by default only for AI Studio, with existing localized guide links', () => {
    const sidebarPlugins = BUILTIN_PLUGINS.filter((plugin) =>
      [
        'voyager.gemini-sidebar-width',
        'voyager.aistudio-sidebar-width',
        'voyager.gemini-sidebar-auto-hide',
        'voyager.gemini-sidebar-full-hide',
      ].includes(plugin.id),
    );
    const rows = featureRows(builtinPlugins(sidebarPlugins));
    expect(ticked(rows)).toEqual([
      ['sidebar-width', ['aistudio', 'gemini']],
      ['sidebar-auto-hide', ['gemini']],
      ['sidebar-full-hide', ['gemini']],
    ]);

    for (const entry of PLUGINS_LOCALES) {
      const prefix = entry.prefix ? `/${entry.prefix}` : '';
      const exists = (path: string) => existsSync(resolve('docs', `.${path}.md`));
      const page = renderPluginsPage(entry, rows, FRESH_INSTALL_ON, exists);
      for (const row of rows) {
        const plugin = row.plugins.gemini![0];
        const name = (plugin.i18n?.[entry.manifest]?.name ?? plugin.name).replace(/^Gemini · /, '');
        const guide = row.feature === 'sidebar-width' ? 'sidebar' : 'sidebar-auto-hide';
        const label = `[${name}](${prefix}/guide/${guide})`;
        expect(page).toContain(`| **${label}** |`);
        expect(cells(page, label)).toEqual([
          '✓',
          row.feature === 'sidebar-width' ? 'on' : '',
          '',
          '',
          '',
          '',
          '',
        ]);
      }
    }
  });
});
