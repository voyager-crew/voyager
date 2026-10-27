import { describe, expect, it } from 'vitest';

import { validateHostCatalogFile } from './hostCatalogFile';

const VALID = {
  id: 'voyager.deepseek-reading-width',
  name: 'DeepSeek · Reading width',
  version: '1.1.0',
  description: 'd',
  author: 'voyager-official',
  category: 'readability',
  license: 'MIT',
  engine: '>=1.2.0',
  tier: 'declarative',
  matches: ['https://chat.deepseek.com/*'],
  contributes: { styles: [{ css: 'body{--x:1}', source: 'style.css' }] },
};

function file(plugins: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    format: 1,
    host: 'chat.deepseek.com',
    generatedAt: '2026-09-07T00:00:00.000Z',
    plugins,
    ...overrides,
  };
}

describe('validateHostCatalogFile', () => {
  it('accepts explicit revocations without requiring the optional field', () => {
    expect(validateHostCatalogFile(file([]), 'chat.deepseek.com')?.revoked).toBeUndefined();
    const result = validateHostCatalogFile(
      file([VALID], { revoked: ['voyager.deepseek-retired'] }),
      'chat.deepseek.com',
    );
    expect(result?.revoked).toEqual(['voyager.deepseek-retired']);
    expect(result?.issues).toEqual([]);
    expect(result?.manifests.map((plugin) => plugin.id)).toEqual([VALID.id]);
  });

  it('skips invalid revocations and reports them without dropping valid plugins', () => {
    const result = validateHostCatalogFile(
      file([VALID], { revoked: ['voyager.deepseek-retired', null, 42, {}, '', '  '] }),
      'chat.deepseek.com',
    );
    expect(result?.revoked).toEqual(['voyager.deepseek-retired']);
    expect(result?.issues.map((issue) => issue.path)).toEqual([
      'revoked[1]',
      'revoked[2]',
      'revoked[3]',
      'revoked[4]',
      'revoked[5]',
    ]);
    expect(result?.manifests.map((plugin) => plugin.id)).toEqual([VALID.id]);
  });

  it('ignores a malformed revocation list without discarding the catalog', () => {
    const result = validateHostCatalogFile(
      file([VALID], { revoked: 'voyager.deepseek-retired' }),
      'chat.deepseek.com',
    );
    expect(result?.revoked).toEqual([]);
    expect(result?.issues).toEqual([
      { path: 'revoked', message: 'must be an array of plugin ids' },
    ]);
    expect(result?.manifests.map((plugin) => plugin.id)).toEqual([VALID.id]);
  });

  it('accepts a well-formed file and returns validated manifests', () => {
    const result = validateHostCatalogFile(file([VALID]), 'chat.deepseek.com');
    expect(result).not.toBeNull();
    expect(result?.manifests.map((m) => m.id)).toEqual(['voyager.deepseek-reading-width']);
    expect(result?.issues).toEqual([]);
    expect(result?.generatedAt).toBe('2026-09-07T00:00:00.000Z');
  });

  it('a plugin whose select offers an empty choice stays installed', () => {
    const auto = {
      ...VALID,
      contributes: {
        ...VALID.contributes,
        settings: {
          width: {
            type: 'select',
            label: 'Width',
            default: '',
            options: [
              { value: '', label: 'Automatic' },
              { value: 'wide', label: 'Wide' },
            ],
          },
        },
      },
    };
    const result = validateHostCatalogFile(file([auto]), 'chat.deepseek.com');
    expect(result?.manifests.map((plugin) => plugin.id)).toEqual([VALID.id]);
  });

  it('matches the host case-insensitively but rejects a different host', () => {
    expect(validateHostCatalogFile(file([VALID]), 'Chat.DeepSeek.com')).not.toBeNull();
    expect(validateHostCatalogFile(file([VALID]), 'claude.ai')).toBeNull();
  });

  it('discards the whole file for an unknown format, a missing host or a non-array plugin list', () => {
    expect(validateHostCatalogFile(file([VALID], { format: 2 }), 'chat.deepseek.com')).toBeNull();
    expect(validateHostCatalogFile(file([VALID], { format: '1' }), 'chat.deepseek.com')).toBeNull();
    expect(
      validateHostCatalogFile(file([VALID], { host: undefined }), 'chat.deepseek.com'),
    ).toBeNull();
    expect(
      validateHostCatalogFile(file([], { plugins: { not: 'array' } }), 'chat.deepseek.com'),
    ).toBeNull();
    expect(validateHostCatalogFile(null, 'chat.deepseek.com')).toBeNull();
    expect(validateHostCatalogFile([VALID], 'chat.deepseek.com')).toBeNull();
  });

  it('skips invalid and duplicate entries individually and reports them', () => {
    const result = validateHostCatalogFile(
      file([VALID, { id: '' }, { ...VALID, name: 'dup' }]),
      'chat.deepseek.com',
    );
    expect(result?.manifests.map((m) => m.name)).toEqual(['DeepSeek · Reading width']);
    expect(result?.issues.some((issue) => issue.path.startsWith('plugins[1]'))).toBe(true);
    expect(result?.issues).toContainEqual({
      path: 'plugins[2].id',
      message: 'duplicate plugin id',
    });
  });

  it('accepts a site section that covers the host and reports one that does not', () => {
    const site = {
      id: 'deepseek',
      label: 'DeepSeek',
      matches: ['https://chat.deepseek.com/*'],
      selectors: { userTurn: '.ds-message.user' },
      theme: { hostSelector: 'body', lightSelector: 'body.light', darkSelector: 'body.dark' },
      brandColor: '#123456',
      capabilities: ['chat'],
    };
    const ok = validateHostCatalogFile(file([VALID], { site }), 'chat.deepseek.com');
    expect(ok?.site?.brandColor).toBe('#123456');
    expect(ok?.site?.capabilities).toEqual(new Set(['chat']));
    expect(ok?.issues).toEqual([]);

    const foreign = validateHostCatalogFile(
      file([VALID], { site: { ...site, matches: ['https://claude.ai/*'] } }),
      'chat.deepseek.com',
    );
    expect(foreign?.site).toBeUndefined();
    expect(foreign?.issues).toContainEqual({
      path: 'site.matches',
      message: 'does not cover this host',
    });

    const invalid = validateHostCatalogFile(
      file([VALID], { site: { ...site, selectors: { userTurn: '[' } } }),
      'chat.deepseek.com',
    );
    expect(invalid?.site?.id).toBe('deepseek');
    expect(invalid?.siteIssues.some((issue) => issue.path === 'site.selectors.userTurn')).toBe(
      true,
    );
    // The complete turn group and plugin list survive a malformed semantic locator.
    document.body.innerHTML =
      '<div class="ds-message"><span class="ds-collapsible-text">Kept question</span></div>';
    expect(document.querySelector(invalid!.site!.selectors.userTurn)?.textContent).toBe(
      'Kept question',
    );
    document.body.replaceChildren();
    expect(invalid?.manifests).toHaveLength(1);
  });

  it('a newer catalog key no longer drops every remote selector fix', () => {
    const site = {
      id: 'deepseek',
      label: 'DeepSeek',
      matches: ['https://chat.deepseek.com/*'],
      selectors: { userTurn: '.ds-message.user-fixed', chatListItemFromTheFuture: 'li' },
      theme: { hostSelector: 'body', lightSelector: 'body.light', darkSelector: 'body.dark' },
      capabilities: ['chat'],
    };
    const result = validateHostCatalogFile(file([VALID], { site }), 'chat.deepseek.com');

    expect(result?.site?.selectors).toEqual({ userTurn: '.ds-message.user-fixed' });
    expect(result?.issues).toEqual([]);
    expect(result?.siteIssues).toEqual([
      {
        path: 'site.selectors.chatListItemFromTheFuture',
        message: 'unknown semantic selector key',
      },
    ]);
  });

  it('rejects CSS the bundled validator would reject (remote CSS is untrusted)', () => {
    const remoteImport = {
      ...VALID,
      contributes: { styles: [{ css: '@import url("https://evil.example/x.css");' }] },
    };
    const result = validateHostCatalogFile(file([remoteImport]), 'chat.deepseek.com');
    expect(result?.manifests).toEqual([]);
    expect(result?.issues.length).toBeGreaterThan(0);
  });
});
