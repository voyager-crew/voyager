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

  it('gives a ChatGPT reply selector that finds every reply on a scheduled task too', () => {
    const listed = scriptedPage.match(
      /- ChatGPT:\n(?:\s+- .*\n)*?\s+- reply \(one per AI reply\): `([^`]+)`/,
    );
    expect(listed).not.toBeNull();
    const reply = listed![1];
    // Shapes sanitized from chatgpt.com on 2026-11-11: an ordinary conversation
    // (5 replies, 5 of each marker) and a scheduled task, whose replies carry
    // no `data-chatgpt-selection-message-id` at all.
    const ordinary = document.createElement('div');
    ordinary.innerHTML = Array.from(
      { length: 5 },
      (_, index) =>
        `<div data-turn-key=""><div data-user-message-bubble="true"></div><div data-chatgpt-selection-message-id="m${index}"><div data-dil-source-message-id="m${index}"><div data-dil-response=""></div></div></div></div>`,
    ).join('');
    const scheduled = document.createElement('div');
    scheduled.innerHTML = `<div data-turn-key=""><div data-user-message-bubble="true"></div><div data-markdown-text-style="assistant-message">${[
      'r1',
      'r2',
    ]
      .map((id) => `<div data-dil-source-message-id="${id}"><div data-dil-response=""></div></div>`)
      .join('')}</div></div>`;
    expect(ordinary.querySelectorAll(reply)).toHaveLength(5);
    expect(scheduled.querySelectorAll(reply)).toHaveLength(2);
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
