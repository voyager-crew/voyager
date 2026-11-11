import { describe, expect, it } from 'vitest';

import { PRIMITIVE_CONTRACTS } from '../../verbs/contracts';
import { authoringSites } from '../authoringSites';
import { readLocalPluginFiles } from '../localPluginFiles';
import { validateLocalManifest } from '../validateLocalManifest';
import type { ContractAudience } from './contractRules';
import { formatJson } from './jsonText';
import { buildPluginContract, renderExample, renderSections } from './pluginContract';
import type { PluginExample } from './pluginExamples';
import { allowsAnyPrimitive, allowsPrimitive } from './siteFacts';

const sites = authoringSites();
const audiences: readonly ContractAudience[] = ['chat', 'agent'];
const cases = sites.flatMap((site) =>
  audiences.map((audience) => [site.label, audience, site] as const),
);

/** What the popup would import for an example: inline JSON, or the picked plugin.json + style.css. */
async function importedManifest(example: PluginExample): Promise<unknown> {
  if (example.css === undefined) return JSON.parse(formatJson(example.manifest));
  const read = await readLocalPluginFiles([
    { name: 'plugin.json', text: formatJson(example.manifest) },
    { name: 'style.css', text: example.css },
  ]);
  if (!read.success) throw new Error(JSON.stringify(read.error));
  return read.data;
}

describe('plugin contract', () => {
  it.each(cases)('teaches only examples the local gate accepts on %s (%s)', async (...args) => {
    const [, audience, site] = args;
    const { examples } = buildPluginContract(site, { audience });
    expect(examples.length).toBeGreaterThan(1);
    for (const example of examples) {
      const result = validateLocalManifest(await importedManifest(example));
      expect(result.success ? [] : result.error).toEqual([]);
    }
  });

  it.each(audiences)('offers a primitive example to %s only where primitives run', (audience) => {
    for (const site of sites) {
      const contract = buildPluginContract(site, { audience });
      const ops = contract.examples.flatMap(
        (example) => (example.manifest.contributes as { domOps?: { op: string }[] }).domOps ?? [],
      );
      expect(ops.some((op) => op.op === 'native')).toBe(allowsPrimitive(site, 'formulaCopy'));
      const titles = contract.sections.map((section) => section.title);
      expect(titles.includes('Primitives')).toBe(allowsAnyPrimitive(site));
    }
  });

  it('never offers a chat AI the theme accent the popup preview flags', () => {
    for (const site of sites) {
      const text = renderSections(buildPluginContract(site, { audience: 'chat' }).sections).join(
        '\n',
      );
      expect(text).not.toMatch(/"theme"[^\n]*(?:accent are allowed|optionally recolors)/);
      expect(text).toContain('Do not add "theme"');
    }
  });

  it('documents every primitive and its params for a coding agent', () => {
    const claude = sites.find((site) => site.id === 'claude')!;
    const text = renderSections(buildPluginContract(claude, { audience: 'agent' }).sections).join(
      '\n',
    );
    for (const contract of PRIMITIVE_CONTRACTS) {
      expect(text).toContain(`- ${contract.name} (sinceEngine ${contract.sinceEngine}): `);
      for (const param of Object.keys(contract.params)) {
        expect(text).toContain(`  - ${param} (`);
      }
    }
  });

  it('teaches the shared Gemini rail without offering catalog identity or Business scope', () => {
    const gemini = sites.find((site) => site.id === 'gemini')!;
    for (const audience of audiences) {
      const text = renderSections(buildPluginContract(gemini, { audience }).sections).join('\n');
      expect(text).toContain('"dataBackend": "shared"');
      expect(text).toContain(
        'All matches must stay on that host: no Business or mixed catalog sites',
      );
      expect(text).toContain(
        'do not set turn, turnItem, conversationIdPattern, conversationIdAttribute or accountIdAttributes',
      );
      expect(text).toContain('Enterprise and custom-website coverage');
      expect(text).not.toContain('turnNavigator` stays unavailable');
    }
  });

  it('tells the author to say NOT POSSIBLE instead of inventing fields', () => {
    for (const audience of audiences) {
      const text = renderSections(buildPluginContract(sites[0], { audience }).sections).join('\n');
      expect(text).toContain('"NOT POSSIBLE: <what and why>"');
      expect(text).toContain('It cannot run JavaScript');
    }
  });

  it('does not rule out a count badge or copy button that a primitive provides', () => {
    for (const [, audience, site] of cases) {
      const sections = buildPluginContract(site, { audience }).sections;
      const offersPrimitives = sections.some((section) => section.title === 'Primitives');
      const limits = sections.find((section) => section.title === 'What a plugin cannot do');
      const text = limits!.lines.join('\n');
      if (offersPrimitives) expect(text).toMatch(/primitive[^\n]*before answering NOT POSSIBLE/);
      else expect(text).not.toMatch(/primitive/i);
    }
  });

  it('warns that a site lacks the anchors other sites declare', () => {
    const claude = sites.find((site) => site.id === 'claude')!;
    const text = renderSections(buildPluginContract(claude, { audience: 'chat' }).sections).join(
      '\n',
    );
    expect(text).toMatch(/Claude does not declare [^\n]*thinkingBlock/);
  });

  it('renders file examples as plugin.json and style.css blocks that parse back', () => {
    const [example] = buildPluginContract(sites[0], { audience: 'agent' }).examples;
    const text = renderExample(example).join('\n');
    const json = /```json\n([\s\S]*?)\n```/.exec(text)![1];
    expect(JSON.parse(json)).toEqual(example.manifest);
    expect(text).toContain(`\`\`\`css\n${example.css!.trimEnd()}\n\`\`\``);
  });
});
