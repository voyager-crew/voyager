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
 */
import type { SiteAdapter } from '../../types';
import {
  EXAMPLES_CONDITION,
  SKILL_EXAMPLES_FILE,
  SKILL_PRIMITIVES_FILE,
  skillSiteFile,
} from './authoringDocs';
import { type ContractRefs, type ContractSection, IN_DOCUMENT_REFS } from './contractRules';
import {
  SITE_SECTION_PREFIX,
  buildPluginContract,
  renderExample,
  renderSections,
  siteSection,
} from './pluginContract';
import { PRIMITIVES_TITLE, offeredPrimitiveNames } from './primitivesSection';
import { primitiveDetailLines } from './siteFacts';
import { WRITE_PLUGIN_SKILL_BASE_URL, createPageFile } from './skillLink';

const PAGE_REFS: ContractRefs = {
  ...IN_DOCUMENT_REFS,
  engine: 'Never go above the user’s engine version.',
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
    'Reply with exactly one ```json fenced code block holding the complete manifest, CSS inlined, and no other code block. The user pastes it into Voyager, so write no files or commands.',
  ],
};

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
    'Voyager is a browser extension for AI chat sites. A Voyager plugin is a JSON manifest plus CSS that restyles or rearranges the page through reversible changes; Voyager checks it strictly on import and runs no code from it.',
    '',
    `The user’s message gives their request and their Voyager plugin engine version. This page follows engine ${contract.engineVersion}: use nothing whose sinceEngine is above the user’s version.`,
    '',
    ...renderSections(sections),
    '## Example (adapt it; do not copy its purpose)',
    '',
    ...renderExample(example),
    `Read ${WRITE_PLUGIN_SKILL_BASE_URL}${SKILL_EXAMPLES_FILE} ${EXAMPLES_CONDITION} Inline their style.css as { "css": "..." } and use this page’s "matches" and anchors.`,
    '',
    ...renderSections([REPLY_FORMAT]),
  ].join('\n');
}

/** Every site's chat page, keyed by its path relative to `docs/public/create/`. */
export function renderCreatePages(sites: readonly SiteAdapter[]): ReadonlyMap<string, string> {
  return new Map(sites.map((site) => [createPageFile(site.id), renderCreatePage(site)]));
}
