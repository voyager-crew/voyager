import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUNDLED_SITE_ADAPTERS } from '@/features/plugins/catalog/sites';
import { folderSkinCss } from '@/features/plugins/verbs/folders/skinCss';
import { contentStylePartPaths } from '@/tests/contentStyle';

/**
 * Light and dark reach injected CSS through one hook, `html[data-gv-scheme]`,
 * which `platformTheme` stamps from the active `SiteAdapter`.
 *
 * Every rule used to name the hosts it knew instead — Gemini's
 * `.theme-host.dark-theme`, AI Studio's `body.dark-theme`, ChatGPT's
 * `html.dark`. Adding a platform meant extending all of them, and the once that
 * was missed the whole extension rendered light on a dark DeepSeek. The point
 * of the hook is that the next platform is one line of `site.json`; this is
 * what keeps it that way.
 */
const STYLESHEETS = [
  ...contentStylePartPaths(),
  'src/features/timeline/timeline.css',
  'src/features/timeline/timelineContextMenu.css',
  'src/features/timeline/timelineSlider.css',
  'src/features/timeline/timelinePreview.css',
  'src/pages/content/selectionToolbar/selectionToolbar.css',
  'src/pages/content/highlight/highlight.css',
  'src/pages/content/defaultModel/styles.css',
  'src/pages/content/folder/floatingPanel.css',
  'src/pages/content/folder/floatingPanelPolish.css',
  'src/pages/content/folder/floatingPanelPolishSchemes.css',
  'src/pages/content/folder/floatingPanelSiteOptions.css',
  'src/pages/content/folder/floatingTree/inlineTree.css',
  'src/pages/content/folder/sidebarTreeTokens.css',
  'src/pages/content/folder/aistudioTreeTokens.css',
  'src/features/plugins/verbs/folders/sectionTree.css',
  'src/pages/content/folder/folderSettings/folderSettings.css',
  'src/pages/content/folder/sidebarActivityList.css',
  'src/features/plugins/catalog/sites/chatgpt/plugins/reading-width/style.css',
  'src/features/plugins/catalog/sites/claude/plugins/reading-width/style.css',
  'src/features/plugins/catalog/sites/claude/plugins/cjk-render-fix/style.css',
  'src/features/plugins/catalog/sites/deepseek/plugins/reading-width/style.css',
  'src/features/plugins/catalog/sites/deepseek/plugins/timeline/style.css',
] as const;

const HOST_DIALECTS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: '.theme-host.<scheme>-theme', pattern: /\.theme-host\.(?:dark|light)-theme/ },
  { name: 'body.<scheme>-theme', pattern: /\bbody\.(?:dark|light)-theme/ },
  { name: 'html.<scheme>-theme', pattern: /\bhtml\.(?:dark|light)-theme/ },
  { name: 'html.dark / html.light', pattern: /\bhtml\.(?:dark|light)(?![-\w])/ },
  { name: ':root.dark / :root.light', pattern: /:root\.(?:dark|light)(?![-\w])/ },
  // Claude's own lightSelector. It is a host dialect like any other and slipped
  // through the first version of this list.
  { name: ':root:not(.dark)', pattern: /:root:not\(\.dark\)/ },
  { name: 'body.dark / body.light', pattern: /\bbody\.(?:dark|light)(?![-\w])/ },
  { name: 'html[dark]', pattern: /\bhtml\[dark\]/ },
  { name: '.dark-mode', pattern: /\.dark-mode(?![-\w])/ },
  // Quote-agnostic: the file happens to use single quotes, but a rule written
  // with double quotes is the same dialect and must not slip through.
  { name: '[data-theme=<scheme>]', pattern: /\[data-theme=["']?(?:dark|light)["']?\]/ },
  {
    name: '[data-color-scheme=<scheme>]',
    pattern: /\[data-color-scheme=["']?(?:dark|light)["']?\]/,
  },
];

/** A comment may name a dialect while explaining it; only parsed CSS counts. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function expectSharedScheme(css: string): void {
  const parsed = stripComments(css);
  const found = HOST_DIALECTS.filter(({ pattern }) => pattern.test(parsed)).map(({ name }) => name);

  expect(
    found,
    "Use html[data-gv-scheme='dark'] instead. A site that marks its theme some other " +
      'way says so in its site.json theme descriptor, which platformTheme already reads.',
  ).toEqual([]);
}

describe.each(STYLESHEETS)('%s', (stylesheet) => {
  it('routes light/dark through data-gv-scheme, never a host dialect', () => {
    expectSharedScheme(readFileSync(resolve(__dirname, '../../../..', stylesheet), 'utf8'));
  });
});

it.each(
  BUNDLED_SITE_ADAPTERS.flatMap((site) =>
    site.folderSkin
      ? [[site.id, folderSkinCss(`gv-${site.id}-folder-section`, site.folderSkin)] as const]
      : [],
  ),
)('%s folder tokens generate CSS using the shared scheme', (_site, css) => {
  expectSharedScheme(css);
});
