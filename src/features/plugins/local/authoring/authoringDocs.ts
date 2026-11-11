/**
 * The documents a coding agent reads, rendered from the plugin contract:
 * - the public skill (every site; `bun run skills:build` writes its files to
 *   `docs/public/skills/write-voyager-plugin/`): SKILL.md with the rules every
 *   plugin needs and one example, plus `sites/<site>.md`, `primitives.md` and
 *   `examples.md`, which only some requests reach and SKILL.md links, and
 * - the `AGENTS.md` that `create-voyager-plugin init` writes into a plugin
 *   folder (one site, one self-contained file).
 * Both take the sites explicitly so the CLI, which has no Vite glob, renders
 * exactly what the extension build would.
 */
import type { SiteAdapter } from '../../types';
import { authoringWorkflowSection } from './authoringWorkflow';
import type { ContractRefs, ContractSection } from './contractRules';
import {
  SITE_SECTION_PREFIX,
  buildPluginContract,
  renderExample,
  renderSections,
  siteSection,
} from './pluginContract';
import { PRIMITIVES_TITLE, primitivesSection } from './primitivesSection';
import { isUnrestrictedSite, restrictsPrimitives } from './siteFacts';
import {
  WRITE_PLUGIN_SKILL_BASE_URL,
  WRITE_PLUGIN_SKILL_NAME,
  WRITE_PLUGIN_SKILL_URL,
} from './skillLink';

const INTRO = [
  'Voyager is a browser extension for AI chat sites. A local plugin is a declarative JSON manifest (plugin.json) plus CSS that restyles or rearranges a chat page through reversible page changes. It runs no code of its own: Voyager checks it strictly on import, applies it, and removes every change when the plugin is turned off.',
];

export const SKILL_ENTRY_FILE = 'SKILL.md';
export const SKILL_PRIMITIVES_FILE = 'primitives.md';
export const SKILL_EXAMPLES_FILE = 'examples.md';

/** When an author needs the examples beyond the first: the condition every pointer to them states. */
export const EXAMPLES_CONDITION =
  'when the plugin needs a setting the user adjusts in the popup, or calls a primitive: it has a worked example of each.';

/** A site's file in the skill folder, relative to SKILL.md. */
export function skillSiteFile(site: SiteAdapter): string {
  return `sites/${site.id}.md`;
}

const SKILL_REFS: ContractRefs = {
  sites: 'the site files, sites/<site>.md',
  primitives: `[${SKILL_PRIMITIVES_FILE}](${SKILL_PRIMITIVES_FILE})`,
};

/** Where the plugin may run: the site the reference sections were written for. */
function referenceSite(sites: readonly SiteAdapter[]): SiteAdapter {
  const site = sites.find(isUnrestrictedSite) ?? sites[0];
  if (!site) throw new Error('no site adapters to render the plugin contract from');
  return site;
}

/** The sections every site shares: the contract without its site facts and primitive list. */
function sharedSections(sections: readonly ContractSection[]): ContractSection[] {
  return sections.filter(
    (section) =>
      !section.title.startsWith(SITE_SECTION_PREFIX) && section.title !== PRIMITIVES_TITLE,
  );
}

function labelList(labels: readonly string[], conjunction: 'and' | 'or'): string {
  return labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} ${conjunction} ${labels[labels.length - 1]}`
    : (labels[0] ?? '');
}

function skillDescription(sites: readonly SiteAdapter[]): string {
  const labels = labelList(
    sites.map((site) => site.label),
    'or',
  );
  return `Voyager plugin authoring: write and check a local plugin (a JSON manifest plus CSS) for the Voyager browser extension. Use when the user wants to change how ${labels} looks or is laid out through Voyager; to add a small feature Voyager ships as a primitive (copy button, word count, collapse, diagrams, draft save, Ctrl+Enter send, timeline); or to check or fix a plugin that fails to import.`;
}

// The pointer wording decides whether an agent opens the files, so it names when each one is needed.
function indexSection(sites: readonly SiteAdapter[]): ContractSection {
  return {
    title: 'Files to read',
    lines: [
      `This skill is split into files. The links below are relative to this SKILL.md; when a file is not beside it (you read this over the web, or only SKILL.md was saved), fetch it from ${WRITE_PLUGIN_SKILL_BASE_URL}<path>.`,
      '',
      '- Before you write or fix a plugin, read the site file of every site it targets. It has the URL patterns "matches" must use, the semantic anchors the site declares, which primitives run there and the site’s caveats:',
      ...sites.map((site) => `  - ${site.label}: [${skillSiteFile(site)}](${skillSiteFile(site)})`),
      `- Read [${SKILL_PRIMITIVES_FILE}](${SKILL_PRIMITIVES_FILE}) when the request needs behavior that CSS and the four page changes cannot give: copy buttons, counters, collapsing long content, diagrams (Mermaid, ECharts, WaveDrom), saving drafts, send shortcuts, a conversation timeline, formula copy, Vim input or rendering the user’s own LaTeX. Always read it before answering NOT POSSIBLE.`,
      `- Read [${SKILL_EXAMPLES_FILE}](${SKILL_EXAMPLES_FILE}) ${EXAMPLES_CONDITION}`,
    ],
  };
}

/** The public skill's files, keyed by path relative to the skill folder; SKILL.md first. */
export function renderWriteVoyagerPluginSkillFiles(
  sites: readonly SiteAdapter[],
): ReadonlyMap<string, string> {
  const reference = buildPluginContract(referenceSite(sites), {
    audience: 'agent',
    refs: SKILL_REFS,
  });
  const siteIds = sites.map((site) => site.id).join(', ');
  const [firstExample, ...moreExamples] = reference.examples;
  if (!firstExample) throw new Error('the plugin contract has no example');
  const skill = [
    '---',
    `name: ${WRITE_PLUGIN_SKILL_NAME}`,
    `description: ${JSON.stringify(skillDescription(sites))}`,
    '---',
    '',
    '# Write a Voyager plugin',
    '',
    ...INTRO,
    '',
    `This skill is generated from Voyager ${reference.engineVersion}. The latest copy is at ${WRITE_PLUGIN_SKILL_URL}.`,
    '',
    ...renderSections([indexSection(sites)]),
    ...renderSections([authoringWorkflowSection({ scaffolded: false, siteIds })]),
    ...renderSections(sharedSections(reference.sections)),
    `## Example (for ${reference.site.label}; on another site use the "matches" and anchors from its site file)`,
    '',
    ...renderExample(firstExample, 3),
  ].join('\n');

  const examples = [
    '# More Voyager plugin examples',
    '',
    `Part of the ${WRITE_PLUGIN_SKILL_NAME} skill: the rules are in [${SKILL_ENTRY_FILE}](${SKILL_ENTRY_FILE}). These examples target ${reference.site.label}; on another site use the "matches" and anchors from its site file, and call only the primitives that site file lists.`,
    '',
    ...moreExamples.flatMap((example) => renderExample(example, 2)),
  ].join('\n');

  const restricted = labelList(
    sites.filter(restrictsPrimitives).map((site) => site.label),
    'and',
  );
  const primitives = [
    '# Voyager primitives',
    '',
    `Part of the ${WRITE_PLUGIN_SKILL_NAME} skill: the manifest rules and examples are in [${SKILL_ENTRY_FILE}](${SKILL_ENTRY_FILE}).${restricted ? ` On ${restricted}, only the primitives that site’s file lists run; every other site runs all of them.` : ''}`,
    '',
    ...primitivesSection(reference.site).lines,
    '',
  ].join('\n');

  const files = new Map<string, string>([
    [SKILL_ENTRY_FILE, skill],
    [SKILL_PRIMITIVES_FILE, primitives],
    [SKILL_EXAMPLES_FILE, examples],
  ]);
  for (const site of sites) {
    files.set(
      skillSiteFile(site),
      [
        `# Voyager plugins on ${site.label}`,
        '',
        `Part of the ${WRITE_PLUGIN_SKILL_NAME} skill: the workflow, rules and examples are in [${SKILL_ENTRY_FILE}](../${SKILL_ENTRY_FILE}), primitives and their params in [${SKILL_PRIMITIVES_FILE}](../${SKILL_PRIMITIVES_FILE}). Scaffold with \`--site ${site.id}\`.`,
        '',
        ...siteSection(site, 'agent').lines,
        '',
      ].join('\n'),
    );
  }
  return files;
}

/** Every skill file in one text, for printing: SKILL.md, then each other file under a path marker. */
export function renderWriteVoyagerPluginSkill(sites: readonly SiteAdapter[]): string {
  return [...renderWriteVoyagerPluginSkillFiles(sites)]
    .map(([path, text]) => (path === SKILL_ENTRY_FILE ? text : `<!-- ${path} -->\n\n${text}`))
    .join('\n');
}

/** The AGENTS.md of a scaffolded plugin folder for one site. */
export function renderScaffoldAgents(site: SiteAdapter): string {
  const contract = buildPluginContract(site, { audience: 'agent' });
  return [
    `# Voyager plugin for ${site.label}`,
    '',
    ...INTRO,
    '',
    `Generated by create-voyager-plugin for Voyager ${contract.engineVersion}. The full skill, covering every site, is at ${WRITE_PLUGIN_SKILL_URL}.`,
    '',
    ...renderSections([authoringWorkflowSection({ scaffolded: true, siteIds: site.id })]),
    ...renderSections(contract.sections),
    '## Examples',
    '',
    ...contract.examples.flatMap((example) => renderExample(example)),
  ].join('\n');
}
