import { describe, expect, it } from 'vitest';

import { canonicalJson } from '@/core/utils/canonicalHash';

import { formatJson } from '../authoring/jsonText';
import { buildPluginContract } from '../authoring/pluginContract';
import { authoringSites } from '../authoringSites';
import { MAX_LOCAL_PLUGIN_IMPORT_CHARS, MAX_LOCAL_PLUGIN_STYLES } from '../localPluginFiles';
import { type LocalPluginImportDeps, importLocalPlugin } from '../localPluginImport';
import type { LocalPluginRecordMap } from '../localPluginStore';
import { checkPluginReply } from '../pluginReply';
import { classifyReplyBlock } from './replyBlock';

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
const TEXT = JSON.stringify(MANIFEST, null, 2);

function variant(patch: Record<string, unknown>): string {
  return JSON.stringify({ ...MANIFEST, ...patch });
}

/** Installs through the real import into an in-memory store. */
function memoryStore(): { deps: LocalPluginImportDeps; records: () => LocalPluginRecordMap } {
  let records: Record<string, LocalPluginRecordMap[string]> = {};
  let now = 0;
  return {
    deps: {
      loadRecords: async () => records,
      installDisabled: async (manifest) => {
        now += 1;
        const id = manifest.id as string;
        records = { ...records, [id]: { manifest, importedAt: now, updatedAt: now } };
      },
    },
    records: () => records,
  };
}

async function install(text: string): Promise<LocalPluginRecordMap> {
  const store = memoryStore();
  const checked = await checkPluginReply(text, store.deps.loadRecords);
  if (!checked.ok) throw new Error('fixture must install');
  await importLocalPlugin(checked.raw, store.deps);
  return store.records();
}

const exampleBlocks = authoringSites().flatMap((site) =>
  (['chat', 'agent'] as const).flatMap((audience) =>
    buildPluginContract(site, { audience }).examples.map(
      (example) =>
        [`${site.id} ${audience}: ${example.title}`, formatJson(example.manifest)] as const,
    ),
  ),
);

const invalidBlocks: readonly (readonly [string, string])[] = [
  ['a scripted tier', variant({ tier: 'scripted' })],
  ['an id that is not a slug', variant({ id: 'Not A Slug' })],
  ['a site Voyager does not support', variant({ matches: ['https://example.com/*'] })],
  ['an unresolved engine', variant({ engine: '>=next' })],
  ['a missing name', JSON.stringify({ ...MANIFEST, name: undefined })],
  [
    'a CSS file reference',
    variant({ contributes: { ...MANIFEST.contributes, styles: [{ file: 'style.css' }] } }),
  ],
  [
    'too many style entries',
    variant({
      contributes: {
        ...MANIFEST.contributes,
        styles: Array.from({ length: MAX_LOCAL_PLUGIN_STYLES + 1 }, () => ({ css: '.gv-a{}' })),
      },
    }),
  ],
  ['an unknown op', variant({ contributes: { domOps: [{ op: 'eval', code: 'x' }] } })],
];

/** Measured on Gemini's Flash: a format of its own, which the old gate showed nothing for. */
const INVENTED_FORMAT = JSON.stringify({
  name: 'Wide chat',
  description: 'Makes the chat wider',
  version: '1.0',
  target: 'gemini',
  minEngineVersion: '1.0.0',
  css: '.conversation{max-width:100%}',
});

const attemptBlocks: readonly (readonly [string, string])[] = [
  ['JSON with no matches', '{ "contributes": {} }'],
  ['JSON with no contributes', '{ "matches": [] }'],
  ['a format of the AI’s own', INVENTED_FORMAT],
];

const notPluginBlocks: readonly (readonly [string, string])[] = [
  ['prose', 'Here is your plugin'],
  ['a JSON array', '[1, 2, 3]'],
  ['broken JSON', '{ "matches": [, "contributes": {} }'],
  ['a block over the import ceiling', `{${' '.repeat(MAX_LOCAL_PLUGIN_IMPORT_CHARS)}}`],
];

const FENCED_REPLY = ['a whole fenced reply', `\`\`\`json\n${TEXT}\n\`\`\``] as const;

describe('classifying a code block of a Create reply', () => {
  it.each([...exampleBlocks, ...invalidBlocks, ...attemptBlocks, ...notPluginBlocks])(
    'agrees with the real import on %s',
    async (_label, text) => {
      const verdict = classifyReplyBlock(text, {});
      const checked = await checkPluginReply(text, async () => ({}));
      expect(verdict.kind === 'installable').toBe(checked.ok);
      if (verdict.kind !== 'installable' || !checked.ok) return;
      const imported = await importLocalPlugin(checked.raw, memoryStore().deps);
      expect(imported.ok).toBe(true);
      expect(verdict.manifestId).toBe(checked.manifest.id);
    },
  );

  it('installs every chat example the contract teaches', () => {
    const chat = exampleBlocks.filter(([label]) => label.includes(' chat: '));
    expect(chat.length).toBeGreaterThan(0);
    for (const [, text] of chat) expect(classifyReplyBlock(text, {}).kind).toBe('installable');
  });

  it.each([...invalidBlocks, ...attemptBlocks])('rejects %s and says where', (_label, text) => {
    const verdict = classifyReplyBlock(text, {});
    expect(verdict.kind).toBe('rejected');
    if (verdict.kind === 'rejected') expect(verdict.issues.length).toBeGreaterThan(0);
  });

  it('reports the same problems the popup lists for a pasted reply', async () => {
    const text = variant({ tier: 'scripted', matches: ['https://example.com/*'] });
    const verdict = classifyReplyBlock(text, {});
    const checked = await checkPluginReply(text, async () => ({}));
    if (verdict.kind !== 'rejected' || checked.ok || !('issues' in checked)) {
      throw new Error('both must reject with issues');
    }
    expect(verdict.issues.length).toBeGreaterThan(1);
    expect(verdict.issues).toEqual(checked.issues);
  });

  it('keeps the id of a rejected plugin when it is readable', () => {
    expect(classifyReplyBlock(variant({ tier: 'scripted' }), {})).toMatchObject({
      kind: 'rejected',
      manifestId: 'local.me.rounded',
    });
    expect(classifyReplyBlock(variant({ id: 'Not A Slug' }), {})).toMatchObject({
      kind: 'rejected',
      manifestId: null,
    });
  });

  it.each([...notPluginBlocks, FENCED_REPLY])('ignores %s', (_label, text) => {
    expect(classifyReplyBlock(text, {})).toEqual({ kind: 'none' });
  });

  it('calls a plugin new when nothing is installed under its id', () => {
    expect(classifyReplyBlock(TEXT, {})).toEqual({
      kind: 'installable',
      manifestId: 'local.me.rounded',
      install: { kind: 'new' },
    });
  });

  it('calls a block installed when it is exactly what was imported', async () => {
    const records = await install(TEXT);
    expect(classifyReplyBlock(`\n  ${TEXT}\n`, records)).toMatchObject({
      install: { kind: 'installed' },
    });
  });

  it('calls a changed block of the same id an update of the installed version', async () => {
    const records = await install(TEXT);
    const changed = variant({ version: '1.1.0', description: 'Rounder' });
    expect(classifyReplyBlock(changed, records)).toMatchObject({
      kind: 'installable',
      manifestId: 'local.me.rounded',
      install: { kind: 'update', previousVersion: '1.0.0' },
    });
    expect(classifyReplyBlock(variant({ description: 'Rounder' }), records)).toMatchObject({
      install: { kind: 'update', previousVersion: '1.0.0' },
    });
  });

  it('calls a block installed when the browser stored its keys in another order', async () => {
    const records = await install(TEXT);
    // Chrome's storage hands objects back with their keys sorted.
    const reread = Object.fromEntries(
      Object.entries(records).map(([id, record]) => [
        id,
        {
          ...record,
          manifest: JSON.parse(canonicalJson(record.manifest)) as typeof record.manifest,
        },
      ]),
    );
    expect(JSON.stringify(reread['local.me.rounded'].manifest)).not.toBe(
      JSON.stringify(records['local.me.rounded'].manifest),
    );
    expect(classifyReplyBlock(TEXT, reread)).toMatchObject({ install: { kind: 'installed' } });
  });

  it('matches an id written with or without the local prefix', async () => {
    const records = await install(TEXT);
    expect(classifyReplyBlock(variant({ id: 'local.me.rounded' }), records)).toMatchObject({
      manifestId: 'local.me.rounded',
      install: { kind: 'installed' },
    });
  });
});
