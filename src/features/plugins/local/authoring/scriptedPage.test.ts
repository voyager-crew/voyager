import { describe, expect, it } from 'vitest';

import { DEFAULT_ADAPTERS } from '../../sites/registry';
import { extractPluginReplyJson } from '../localPluginFiles';
import { validateLocalManifest } from '../validateLocalManifest';
import { renderScaffoldAgents, renderWriteVoyagerPluginSkillFiles } from './authoringDocs';
import { renderCreatePages } from './createPages';
import { formatJson } from './jsonText';
import { SCRIPTED_PAGE_FILE, SCRIPTED_PAGE_URL } from './scriptedContract';
import { buildScriptedExample } from './scriptedPage';
import { createPageFile } from './skillLink';

const pages = renderCreatePages(DEFAULT_ADAPTERS);
const scriptedPage = pages.get(SCRIPTED_PAGE_FILE)!;
const sites = DEFAULT_ADAPTERS.map((site) => [site.label, site] as const);

function jsonBlocks(text: string): unknown[] {
  return [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
}

describe('scripted tier in the authoring material', () => {
  it.each(sites)('points the %s create page at the shared scripted page', (_label, site) => {
    const page = pages.get(createPageFile(site.id))!;
    expect(page).toContain(`Read ${SCRIPTED_PAGE_URL} when the request needs such behavior`);
    expect(page).toContain('"Allow User Scripts"');
  });

  it.each(sites)('teaches a scripted example the scripted gate accepts on %s', (_label, site) => {
    const { manifest } = buildScriptedExample(site);
    const result = validateLocalManifest(JSON.parse(formatJson(manifest)), undefined, {
      allowScripted: true,
    });
    expect(result.success ? [] : result.error).toEqual([]);
  });

  it('shows one scripted example that the scripted gate accepts and the declarative gate refuses', () => {
    const [example, ...rest] = jsonBlocks(scriptedPage);
    expect(rest).toEqual([]);
    const accepted = validateLocalManifest(example, undefined, { allowScripted: true });
    expect(accepted.success ? [] : accepted.error).toEqual([]);
    const refused = validateLocalManifest(example);
    expect(refused.success).toBe(false);
  });

  it('keeps a scripted reply in the one json block Create mode reads', () => {
    const block = formatJson(buildScriptedExample(DEFAULT_ADAPTERS[0]).manifest);
    const reply = `This plugin runs code.\n\n\`\`\`json\n${block}\n\`\`\`\n`;
    const extracted = extractPluginReplyJson(reply);
    expect(extracted).toEqual({ ok: true, json: block });
  });

  it('tells coding agents that check refuses the tier and Create mode makes it', () => {
    const skill = renderWriteVoyagerPluginSkillFiles(DEFAULT_ADAPTERS).get('SKILL.md')!;
    const agents = renderScaffoldAgents(DEFAULT_ADAPTERS[0]);
    for (const text of [skill, agents]) {
      expect(text).toContain('`create-voyager-plugin check` refuses "tier": "scripted"');
      expect(text).toContain('only Create mode makes one');
    }
  });
});
