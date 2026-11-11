/**
 * `buildPluginContract(site, options)`: everything an author (an AI in a chat
 * tab, or a coding agent) needs to write a local plugin for one site, as text
 * sections plus worked examples. The popup prompt, the per-site chat pages,
 * the scaffold's AGENTS.md and the public skill are all rendered from it, and
 * the examples are tested against the import gate, so they never disagree.
 */

import type { SiteAdapter } from '../../types';
import { EFFECTIVE_PLUGIN_ENGINE_VERSION } from '../../verbs/contracts';
import {
  type ContractAudience,
  type ContractRefs,
  type ContractSection,
  impossibleSection,
  localRulesSection,
  manifestSection,
  pageChangesSection,
  selectorsSection,
  settingsSection,
  stylesSection,
} from './contractRules';
import { formatJson } from './jsonText';
import { type PluginExample, buildPluginExamples } from './pluginExamples';
import { primitivesSection } from './primitivesSection';
import { allowsAnyPrimitive, siteAnchors, siteFactLines } from './siteFacts';

export interface PluginContractOptions {
  readonly audience: ContractAudience;
  /** Where the rules send the reader for site facts and primitives; defaults to sections of the same document. */
  readonly refs?: ContractRefs;
}

export interface PluginContract {
  readonly site: SiteAdapter;
  readonly engineVersion: string;
  readonly sections: readonly ContractSection[];
  readonly examples: readonly PluginExample[];
}

/**
 * Whether the contract teaches primitives on `site`: wherever the gate accepts
 * a `native` op, for a chat AI as for a coding agent, since both imports run
 * the same gate.
 */
export function offersPrimitives(site: SiteAdapter): boolean {
  return allowsAnyPrimitive(site);
}

export const SITE_SECTION_PREFIX = 'Target site: ';

/** `primitiveDetails: false` leaves the primitive list and its caveats to another document. */
export function siteSection(
  site: SiteAdapter,
  audience: ContractAudience,
  { primitiveDetails = true }: { primitiveDetails?: boolean } = {},
): ContractSection {
  return {
    title: `${SITE_SECTION_PREFIX}${site.label}`,
    lines: siteFactLines(site, {
      primitives: offersPrimitives(site),
      theme: audience === 'agent',
      primitiveDetails,
    }),
  };
}

export function buildPluginContract(
  site: SiteAdapter,
  options: PluginContractOptions,
): PluginContract {
  const { audience, refs } = options;
  const primitives = offersPrimitives(site);
  const templateKey = siteAnchors(site)[0] ?? 'userTurn';
  return {
    site,
    engineVersion: EFFECTIVE_PLUGIN_ENGINE_VERSION,
    sections: [
      siteSection(site, audience),
      manifestSection(audience, refs),
      stylesSection(audience),
      pageChangesSection(templateKey, { primitives }),
      settingsSection(),
      localRulesSection(audience, { primitives, refs }),
      ...(primitives ? [primitivesSection(site)] : []),
      ...(audience === 'agent' ? [selectorsSection()] : []),
      impossibleSection(audience, { primitives, refs }),
    ],
    examples: buildPluginExamples(site, {
      styles: audience === 'agent' ? 'file' : 'inline',
      primitives,
    }),
  };
}

/** `## title` and its lines, sections separated by a blank line. */
export function renderSections(sections: readonly ContractSection[], level = 2): string[] {
  const hashes = '#'.repeat(level);
  return sections.flatMap((section) => [`${hashes} ${section.title}`, '', ...section.lines, '']);
}

/** An example as fenced blocks: plugin.json, then style.css when it has one. */
export function renderExample(example: PluginExample, level = 3): string[] {
  return [
    `${'#'.repeat(level)} ${example.title}`,
    '',
    ...(example.css !== undefined ? ['plugin.json:', ''] : []),
    '```json',
    formatJson(example.manifest),
    '```',
    '',
    ...(example.css !== undefined
      ? ['style.css:', '', '```css', example.css.trimEnd(), '```', '']
      : []),
  ];
}
