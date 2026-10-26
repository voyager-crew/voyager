import { describe, expect, it } from 'vitest';

import {
  starConversationId,
  siteConversationConfig,
} from '../../timeline/adapters/catalog/conversationId';
import { requireBundledSiteAdapter } from '../catalog/sites';
import { validateManifest } from '../manifest/validate';
import type { NativeOperation, PluginManifest } from '../types';
import { mergePluginRecords } from './defaultSources';

function manifest(id: string, params: Readonly<Record<string, unknown>>): PluginManifest {
  const result = validateManifest({
    id,
    name: 'Timeline',
    version: '1.0.0',
    description: 'Conversation timeline',
    author: 'voyager-official',
    category: 'navigation',
    license: 'MIT',
    engine: '>=1.9.0',
    tier: 'declarative',
    matches: ['https://chat.deepseek.com/*'],
    contributes: {
      domOps: [{ op: 'native', handler: 'turnNavigator', params }],
      styles: [{ css: '.gv-repaired { color: red; }' }],
    },
  });
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return result.data;
}

function nativeOf(value: PluginManifest): NativeOperation {
  const native = value.contributes.domOps?.find((op) => op.op === 'native');
  if (!native || native.op !== 'native') throw new Error('Expected native operation');
  return native;
}

function namespace(value: PluginManifest): string | null {
  const pattern = nativeOf(value).params.conversationIdPattern;
  return starConversationId(
    siteConversationConfig(
      requireBundledSiteAdapter('deepseek'),
      typeof pattern === 'string' ? pattern : undefined,
    ),
    'https://chat.deepseek.com/a/chat/s/kept',
  );
}

describe('remote native identity policy', () => {
  it('an online timeline update cannot move saved stars while its locator and CSS repair still apply', () => {
    const bundle = manifest('voyager.deepseek-timeline', {});
    const remote = manifest(bundle.id, { conversationIdPattern: '^/(a)', turn: '.repaired' });
    const [accepted] = mergePluginRecords({
      builtin: [],
      snapshot: [{ manifest: bundle, sourceId: 'bundled' }],
      remote: [{ manifest: remote, sourceId: 'remote' }],
      remoteAuthoritative: true,
    });
    expect(namespace(accepted.manifest)).toBe('deepseek:conv:kept');
    expect(nativeOf(accepted.manifest).params.turn).toBe('.repaired');
    expect(accepted.manifest.contributes.styles?.[0]).toEqual({
      css: '.gv-repaired { color: red; }',
    });
  });

  it('package-defined identity survives remote replacement while explicitly imported local identity still works', () => {
    const bundle = manifest('voyager.deepseek-timeline', {
      conversationIdPattern: '^/a/chat/(s/[^/?#]+)',
    });
    const remote = manifest(bundle.id, { conversationIdPattern: '^/(a)' });
    const local = manifest('local.me.timeline', { conversationIdPattern: '^/(a)' });
    const accepted = mergePluginRecords({
      builtin: [],
      snapshot: [{ manifest: bundle, sourceId: 'bundled' }],
      remote: [{ manifest: remote, sourceId: 'remote' }],
      local: [{ manifest: local, sourceId: 'local' }],
      remoteAuthoritative: true,
    });
    expect(accepted.map(({ manifest }) => namespace(manifest))).toEqual([
      'deepseek:conv:s/kept',
      'deepseek:conv:a',
    ]);
  });

  it('a newly published timeline also uses the packaged site namespace', () => {
    const remote = manifest('voyager.deepseek-new-timeline', { conversationIdPattern: '^/(a)' });
    const [accepted] = mergePluginRecords({
      builtin: [],
      snapshot: [],
      remote: [{ manifest: remote, sourceId: 'remote' }],
      remoteAuthoritative: true,
    });
    expect(namespace(accepted.manifest)).toBe('deepseek:conv:kept');
  });
});
