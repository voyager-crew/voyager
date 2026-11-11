import { describe, expect, it, vi } from 'vitest';

import { MAX_LOCAL_PLUGIN_IMPORT_CHARS } from './localPluginImport';
import { checkPluginReply, extractPluginReplyJson } from './pluginReply';

const MANIFEST = {
  id: 'me.rounded',
  name: 'Rounded',
  version: '1.0.0',
  description: 'Round my messages',
  author: 'me',
  category: 'readability',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://claude.ai/*'],
  contributes: {
    styles: [{ css: '.gv-plugin-rounded{border-radius:16px}' }],
    domOps: [
      {
        op: 'addClass',
        target: { kind: 'semantic', key: 'userTurn' },
        className: 'gv-plugin-rounded',
      },
    ],
  },
};
const JSON_TEXT = JSON.stringify(MANIFEST, null, 2);

describe('extracting the manifest from an AI reply', () => {
  it.each([
    ['a ```json block inside prose', `Here you go:\n\n\`\`\`json\n${JSON_TEXT}\n\`\`\`\n\nEnjoy!`],
    ['an unlabeled block', `\`\`\`\n${JSON_TEXT}\n\`\`\``],
    ['an uppercase label with indent', `  \`\`\`JSON\n${JSON_TEXT}\n  \`\`\``],
    ['a four-backtick fence', `\`\`\`\`json\n${JSON_TEXT}\n\`\`\`\``],
    ['CRLF line endings', `\`\`\`json\r\n${JSON_TEXT.replace(/\n/g, '\r\n')}\r\n\`\`\`\r\n`],
    ['bare JSON with no fence', `\n${JSON_TEXT}\n`],
  ])('takes %s', (_label, reply) => {
    const result = extractPluginReplyJson(reply);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.json)).toEqual(MANIFEST);
  });

  it('ignores blocks in other languages next to the manifest', () => {
    const reply = `\`\`\`css\n.gv-x{}\n\`\`\`\n\`\`\`json\n${JSON_TEXT}\n\`\`\``;
    const result = extractPluginReplyJson(reply);
    expect(result.ok && JSON.parse(result.json)).toEqual(MANIFEST);
  });

  it('keeps a ``` line inside a longer fence as content', () => {
    const reply = `\`\`\`\`json\n{"a":"\n\`\`\`\n"}\n\`\`\`\``;
    expect(extractPluginReplyJson(reply)).toEqual({ ok: true, json: '{"a":"\n```\n"}' });
  });

  it.each([
    ['two json blocks', `\`\`\`json\n{}\n\`\`\`\ntext\n\`\`\`json\n{}\n\`\`\``, 'multiple-json'],
    [
      'a json and an unlabeled block',
      `\`\`\`json\n{}\n\`\`\`\n\`\`\`\n{}\n\`\`\``,
      'multiple-json',
    ],
    ['prose only', 'Sorry, I cannot help with that.', 'no-json'],
    ['only a css block', '```css\n.gv-x{}\n```', 'no-json'],
    ['prose around unfenced braces', 'Use {"id": 1} like so.', 'no-json'],
    ['whitespace', '  \n\t ', 'empty'],
  ])('refuses %s', (_label, reply, problem) => {
    expect(extractPluginReplyJson(reply)).toEqual({ ok: false, problem });
  });

  it('refuses an oversized reply before scanning it', () => {
    const reply = `\`\`\`json\n${' '.repeat(MAX_LOCAL_PLUGIN_IMPORT_CHARS)}\n\`\`\``;
    expect(extractPluginReplyJson(reply)).toEqual({ ok: false, problem: 'too-long' });
  });

  it('scans a long single line in linear time', () => {
    const reply = `\`\`\`${' '.repeat(MAX_LOCAL_PLUGIN_IMPORT_CHARS - 10)}\``;
    const started = performance.now();
    extractPluginReplyJson(reply);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('checking a reply without installing it', () => {
  const noRecords = vi.fn(async () => ({}));

  it('returns the gated manifest and the exact object to import', async () => {
    const result = await checkPluginReply(`\`\`\`json\n${JSON_TEXT}\n\`\`\``, noRecords);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe('local.me.rounded');
    expect(result.raw).toEqual(MANIFEST);
    expect(result.previousVersion).toBeUndefined();
  });

  it('names the version an import would replace', async () => {
    const records = async () => ({
      'local.me.rounded': {
        manifest: { ...MANIFEST, id: 'local.me.rounded', version: '0.9.0' },
        importedAt: 1,
        updatedAt: 1,
      },
    });
    const result = await checkPluginReply(JSON_TEXT, records);
    expect(result.ok && result.previousVersion).toBe('0.9.0');
  });

  it('reports invalid JSON with the pasted-manifest message', async () => {
    const result = await checkPluginReply('```json\n{ "id": "me.x", }\n```', noRecords);
    expect(result.ok).toBe(false);
    expect('issues' in result && result.issues[0].message).toMatch(/not valid JSON/);
  });

  it('reports every gate issue for a manifest the gate refuses', async () => {
    const bad = { ...MANIFEST, tier: 'scripted' };
    const result = await checkPluginReply(JSON.stringify(bad), noRecords);
    expect('issues' in result && result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['contributes.styles', 'contributes.script.source']),
    );
  });

  it('accepts a reply that runs code, with its source on the manifest', async () => {
    const code = {
      ...MANIFEST,
      tier: 'scripted',
      contributes: { script: { source: 'document.title = "hi";' } },
    };
    const result = await checkPluginReply(JSON.stringify(code), noRecords);
    expect(result.ok && result.manifest.contributes.script).toEqual({
      source: 'document.title = "hi";',
    });
  });

  it('refuses a reply whose CSS would load from the page origin', async () => {
    const probe = {
      ...MANIFEST,
      contributes: { styles: [{ css: "body{background:url('/probe')}" }] },
    };
    const result = await checkPluginReply(JSON.stringify(probe), noRecords);
    expect('issues' in result && result.issues.map((issue) => issue.path)).toEqual([
      'contributes.styles[0].css',
    ]);
  });

  it('passes extraction problems through', async () => {
    expect(await checkPluginReply('no json here', noRecords)).toEqual({
      ok: false,
      problem: 'no-json',
    });
  });
});
