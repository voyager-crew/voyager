/**
 * The page a chat AI reads before it writes a plugin, one per site, rendered
 * from the plugin contract (`audience: 'chat'`). `bun run skills:build` writes
 * them to `docs/public/create/`, served at `createPageUrl(site.id)`, and the
 * message Voyager puts in the composer (`creationMessage.ts`) points there.
 *
 * A page carries what every request needs and one example. The primitive
 * reference, a site's primitive caveats and the other examples stay in the
 * public skill, behind pointers that say when to open them, so the page stays
 * short enough to be read whole.
 *
 * A page holds no triple backtick: on some sites the page itself goes into the
 * composer (`inlineCreatePage.ts`), where a fence turns the rest of the
 * message into a code box. Its example is an indented code block instead.
 */
import type { SiteAdapter } from '../../types';
import {
  EXAMPLES_CONDITION,
  SKILL_EXAMPLES_FILE,
  SKILL_PRIMITIVES_FILE,
  skillSiteFile,
} from './authoringDocs';
import { type ContractRefs, type ContractSection, IN_DOCUMENT_REFS } from './contractRules';
import { formatJson } from './jsonText';
import {
  SITE_SECTION_PREFIX,
  buildPluginContract,
  renderSections,
  siteSection,
} from './pluginContract';
import type { PluginExample } from './pluginExamples';
import { PRIMITIVES_TITLE, offeredPrimitiveNames } from './primitivesSection';
import { SCRIPTED_PAGE_FILE } from './scriptedContract';
import { renderScriptedPage } from './scriptedPage';
import { primitiveDetailLines } from './siteFacts';
import { WRITE_PLUGIN_SKILL_BASE_URL, createPageFile } from './skillLink';

const PAGE_REFS: ContractRefs = {
  ...IN_DOCUMENT_REFS,
  engine: 'Never go above the user’s Voyager version.',
};

function primitivePointerSection(site: SiteAdapter): ContractSection {
  const details = primitiveDetailLines(site).length > 0;
  return {
    title: PRIMITIVES_TITLE,
    lines: [
      `Primitives are behavior Voyager ships as code, called as { "op": "native", "handler": "<name>", "params": { … } }. On ${site.label} these run: ${offeredPrimitiveNames(site).join(', ')}.`,
      '',
      `Read ${WRITE_PLUGIN_SKILL_BASE_URL}${SKILL_PRIMITIVES_FILE} when the request needs behavior that CSS and the page changes cannot give, such as one of these, and always before answering NOT POSSIBLE. It has each primitive’s params and engine floor.`,
      ...(details
        ? [
            `Before you call one, also read ${WRITE_PLUGIN_SKILL_BASE_URL}${skillSiteFile(site)}: how it shares the page with Voyager’s own setting, and its caveats on ${site.label}.`,
          ]
        : []),
    ],
  };
}

const REPLY_FORMAT: ContractSection = {
  title: 'Reply format',
  lines: [
    'Reply with exactly one fenced code block labeled json, holding the complete manifest with CSS inlined, and no other code block. The user pastes it into Voyager, so write no files or commands.',
  ],
};

/** The example's manifest as an indented code block; a chat example inlines its CSS. */
function renderIndentedExample(example: PluginExample): string[] {
  if (example.css !== undefined) throw new Error('a chat example inlines its CSS');
  const manifest = formatJson(example.manifest).split('\n');
  return [`### ${example.title}`, '', ...manifest.map((line) => `    ${line}`), ''];
}

/** The chat page for one site. */
export function renderCreatePage(site: SiteAdapter): string {
  const contract = buildPluginContract(site, { audience: 'chat', refs: PAGE_REFS });
  const [example] = contract.examples;
  if (!example) throw new Error('the plugin contract has no example');
  const sections = contract.sections.map((section) => {
    if (section.title.startsWith(SITE_SECTION_PREFIX)) {
      return siteSection(site, 'chat', { primitiveDetails: false });
    }
    return section.title === PRIMITIVES_TITLE ? primitivePointerSection(site) : section;
  });
  return [
    `# Write a Voyager plugin for ${site.label}`,
    '',
    'Voyager is a browser extension for AI chat sites. A Voyager plugin is a JSON manifest plus CSS that changes the page reversibly; Voyager checks it strictly on import. It runs no code unless it is the scripted kind below.',
    '',
    `This page follows Voyager ${contract.engineVersion}: the user’s message gives their request and their Voyager version.`,
    '',
    ...renderSections(sections),
    '## Example (adapt it; do not copy its purpose)',
    '',
    ...renderIndentedExample(example),
    `Read ${WRITE_PLUGIN_SKILL_BASE_URL}${SKILL_EXAMPLES_FILE} ${EXAMPLES_CONDITION} Inline their style.css as { "css": "..." } and use this page’s "matches" and anchors.`,
    '',
    ...renderSections([REPLY_FORMAT]),
  ].join('\n');
}

/** Every site's chat page and the shared scripted page, keyed by path relative to `docs/public/create/`. */
export function renderCreatePages(sites: readonly SiteAdapter[]): ReadonlyMap<string, string> {
  return new Map([
    ...sites.map((site) => [createPageFile(site.id), renderCreatePage(site)] as const),
    [SCRIPTED_PAGE_FILE, renderScriptedPage(sites)],
  ]);
}
