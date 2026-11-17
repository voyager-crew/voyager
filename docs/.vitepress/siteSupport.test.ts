import { describe, expect, it } from 'vitest';

import type { PluginManifest, SiteAdapter } from '../../src/features/plugins/types';
import { type FeatureRow, PLUGIN_SITES, type PluginSite } from './pluginsPage';
import { loadSiteSupport, supportRows } from './siteSupport';

const plugin = (id: string, settings: Record<string, unknown> = {}): PluginManifest =>
  ({ id, name: id, matches: [], contributes: { settings } }) as unknown as PluginManifest;

/** Folders as the plugin table sees them: native on Gemini and AI Studio, a plugin elsewhere. */
const folders = (plugins: Partial<Record<PluginSite, PluginManifest[]>>): FeatureRow[] => [
  { feature: 'folders', plugins, native: ['gemini', 'aistudio'] },
];

const sendable = (id: string, turnKeyAttributes?: string[]): SiteAdapter =>
  ({
    id,
    matches: [`https://${id}.example/*`],
    selectors: { userTurn: '.user', composer: 'textarea' },
    conversationIdPattern: '^/c/([^/]+)',
    ...(turnKeyAttributes ? { turnKeyAttributes } : {}),
  }) as unknown as SiteAdapter;

/** The sites a row ticks, by row id. */
const ticks = (rows: ReturnType<typeof supportRows>) =>
  Object.fromEntries(
    rows.map((row) => [row.id, PLUGIN_SITES.filter((_, index) => row.cells[index] !== '')]),
  );

describe('site support table', () => {
  it('offers Activity where a plugin site can tell sends apart, and on Gemini natively', () => {
    const rows = folders({
      chatgpt: [plugin('voyager.chatgpt-folders')],
      claude: [plugin('voyager.claude-folders')],
    });
    const adapters = {
      chatgpt: sendable('chatgpt', ['data-turn-key']),
      claude: sendable('claude'),
    };

    expect(ticks(supportRows('folders', rows, adapters, new Set())).activity).toEqual([
      'gemini',
      'chatgpt',
    ]);
  });

  it("ticks a plugin site's hide-filed only when its plugin has that setting", () => {
    const rows = folders({
      chatgpt: [plugin('voyager.chatgpt-folders', { hideFiledChats: { type: 'boolean' } })],
      deepseek: [plugin('voyager.deepseek-folders')],
    });

    expect(ticks(supportRows('folders', rows, {}, new Set()))['hide-filed']).toEqual([
      'gemini',
      'aistudio',
      'chatgpt',
    ]);
  });

  it('keeps Gemini-only popup options and isolation off sites that lack them', () => {
    const rows = folders({ claude: [plugin('voyager.claude-folders')] });
    const table = ticks(supportRows('folders', rows, {}, new Set()));

    expect(table.projects).toEqual(['gemini']);
    expect(table['ai-organize']).toEqual(['gemini']);
    expect(table['account-isolation']).toEqual(['gemini', 'aistudio']);
  });

  it('marks a plugin on by default only where a fresh install runs it', () => {
    const rows = folders({
      chatgpt: [plugin('voyager.chatgpt-folders')],
      claude: [plugin('voyager.claude-folders')],
    });
    const [own] = supportRows('folders', rows, {}, new Set(['voyager.chatgpt-folders']));

    expect(own.cells).toEqual(['on', 'on', 'on', 'yes', '', '', '']);
  });

  it('gives a feature without capabilities its own row only, and an unknown feature none', () => {
    const rows: FeatureRow[] = [
      { feature: 'quote-reply', plugins: { claude: [plugin('voyager.quote')] }, native: [] },
    ];

    expect(ticks(supportRows('quote-reply', rows, {}, new Set()))).toEqual({
      'quote-reply': ['claude'],
    });
    expect(supportRows('missing', rows, {}, new Set())).toEqual([]);
  });

  it('builds a full row for every column from the shipped plugins', () => {
    const data = loadSiteSupport();

    expect(data.sites.map((site) => site.id)).toEqual([...PLUGIN_SITES]);
    expect(data.features.folders.every((row) => row.cells.length === PLUGIN_SITES.length)).toBe(
      true,
    );
    expect(Object.keys(data.locales)).toContain('root');
  });
});
