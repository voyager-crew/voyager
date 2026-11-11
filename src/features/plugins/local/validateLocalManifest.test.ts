import { describe, expect, it } from 'vitest';

import { THEME_VARIABLES, themeVariableName } from '@/core/ui/themeVariables';

import { resolveEngineVersion } from '../engineVersion';
import { validateHostCatalogFile } from '../remote/hostCatalogFile';
import { isLocalPluginId, toLocalPluginId } from './localPluginId';
import { validateLocalManifest } from './validateLocalManifest';

function authored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'me.wide-chat',
    name: 'Wide chat',
    version: '1.0.0',
    description: 'Widen the Claude chat column',
    author: 'Me',
    category: 'layout',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: ['https://claude.ai/*'],
    contributes: {
      styles: [{ css: '.gv-wide{max-width:none}' }],
      domOps: [{ op: 'addClass', target: 'body', className: 'gv-wide' }],
    },
    ...overrides,
  };
}

function paths(input: unknown): string[] {
  const result = validateLocalManifest(input);
  return result.success ? [] : result.error.map((issue) => issue.path);
}

describe('local plugin ids', () => {
  it('forces authored ids into the local.* namespace and keeps one already there', () => {
    expect(toLocalPluginId('me.wide-chat')).toBe('local.me.wide-chat');
    expect(toLocalPluginId('local.me.wide-chat')).toBe('local.me.wide-chat');
    expect(toLocalPluginId('voyager.formula-copy')).toBe('local.voyager.formula-copy');
    expect(isLocalPluginId('local.x')).toBe(true);
    expect(isLocalPluginId('voyager.x')).toBe(false);
  });

  it('rejects ids that are not lowercase reverse-dotted slugs', () => {
    for (const id of ['Me.Tweak', 'me tweak', '.me', 'me.', 'local.', `me.${'x'.repeat(100)}`]) {
      expect(toLocalPluginId(id)).toBeNull();
    }
  });
});

describe('validateLocalManifest', () => {
  it('accepts a declarative manifest and namespaces both the manifest and the stored raw', () => {
    const result = validateLocalManifest(authored());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.manifest.id).toBe('local.me.wide-chat');
    expect(result.data.raw.id).toBe('local.me.wide-chat');
    // An official id cannot be claimed: it is moved into local.* as well.
    const official = validateLocalManifest(authored({ id: 'voyager.formula-copy' }));
    expect(official.success && official.data.manifest.id).toBe('local.voyager.formula-copy');
  });

  it('explains that local imports need a concrete engine instead of contributor next notation', () => {
    const result = validateLocalManifest(authored({ engine: '>=next' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual([
      { path: 'engine', message: expect.stringContaining('concrete engine version') },
    ]);
  });

  it('rejects a scripted tier, since local plugins never carry code', () => {
    expect(paths(authored({ tier: 'scripted' }))).toContain('tier');
  });

  it('rejects an id it cannot namespace', () => {
    expect(paths(authored({ id: 'Bad Id' }))).toContain('id');
  });

  it('keeps matches inside the sites plugins already target', () => {
    expect(paths(authored({ matches: ['https://example.com/*'] }))).toEqual(['matches[0]']);
    expect(paths(authored({ matches: ['<all_urls>'] }))).toEqual(['matches[0]']);
    expect(paths(authored({ matches: ['https://*/*'] }))).toEqual(['matches[0]']);
    expect(paths(authored({ matches: ['https://chat.deepseek.com/a/*'] }))).toEqual([]);
  });

  it('lets local plugins target Gemini and AI Studio, which official plugins never do', () => {
    expect(paths(authored({ matches: ['https://gemini.google.com/*'] }))).toEqual([]);
    expect(paths(authored({ matches: ['https://business.gemini.google/*'] }))).toEqual([]);
    expect(paths(authored({ matches: ['https://aistudio.google.com/prompts/*'] }))).toEqual([]);
    expect(paths(authored({ matches: ['https://*.google.com/*'] }))).toEqual(['matches[0]']);
  });

  it('accepts the Gemini example from the plugin README', () => {
    const example = authored({
      id: 'me.gemini-compact-turns',
      category: 'readability',
      matches: ['https://gemini.google.com/*'],
      contributes: {
        styles: [{ css: '.gv-plugin-compact-turn{margin-block:4px!important}' }],
        domOps: [
          {
            op: 'addClass',
            target: { kind: 'semantic', key: 'userTurn' },
            className: 'gv-plugin-compact-turn',
          },
        ],
      },
    });
    expect(paths(example)).toEqual([]);
  });

  it('accepts a creation that only sets the public theme variables, on every site', () => {
    const css = `:root{${THEME_VARIABLES.map(({ role }) => `${themeVariableName(role)}:#2e3440`).join(';')}}`;
    for (const match of [
      'https://gemini.google.com/*',
      'https://aistudio.google.com/prompts/*',
      'https://claude.ai/*',
    ]) {
      const nord = authored({ matches: [match], contributes: { styles: [{ css }] } });
      expect(paths(nord), match).toEqual([]);
    }
  });

  it('keeps Voyager’s own accent on Gemini: a theme there is rejected', () => {
    const theme = { brand: '#ff0000' };
    expect(paths(authored({ matches: ['https://gemini.google.com/*'], theme }))).toEqual(['theme']);
    expect(paths(authored({ theme }))).toEqual([]);
  });

  it('requires shared data on Gemini and keeps turn navigation closed on AI Studio', () => {
    const native = (matches: string[]) =>
      authored({
        engine: '>=1.4.0',
        matches,
        contributes: {
          styles: [{ css: '.gv-x{color:red}' }],
          domOps: [
            { op: 'addClass', target: 'body', className: 'gv-x' },
            { op: 'native', target: 'body', handler: 'turnNavigator', params: {} },
          ],
        },
      });
    expect(paths(native(['https://gemini.google.com/*']))).toEqual(['contributes.domOps[1]']);
    expect(paths(native(['https://aistudio.google.com/*']))).toEqual(['contributes.domOps[1]']);
    expect(paths(native(['https://claude.ai/*']))).toEqual([]);
  });

  it('imports only an explicit consumer shared timeline with the new engine floor and native identity', () => {
    const input = (
      matches: string[],
      params: Record<string, unknown>,
      engine = `>=${resolveEngineVersion('next')}`,
    ) =>
      authored({
        matches,
        engine,
        contributes: { domOps: [{ op: 'native', handler: 'turnNavigator', params }] },
      });
    const matches = ['https://gemini.google.com/*'];
    const shared = { dataBackend: 'shared', position: 'left' };
    const valid = validateLocalManifest(input(matches, shared));
    expect(valid.success ? [] : valid.error).toEqual([]);
    if (valid.success) expect(valid.data.manifest.id).toBe('local.me.wide-chat');
    expect(paths(input(matches, shared, '>=1.5.0'))).toContain('engine');
    for (const scope of [
      ['https://business.gemini.google/*'],
      [...matches, 'https://business.gemini.google/*'],
      [...matches, 'https://claude.ai/*'],
      ['https://claude.ai/*'],
    ])
      expect(paths(input(scope, shared))).toContain('contributes.domOps[0]');
    for (const [key, value] of Object.entries({
      turn: '.fake',
      turnItem: '.fake',
      conversationIdPattern: '^/app/(.+)',
      conversationIdAttribute: 'data-conversation',
      accountIdAttributes: ['data-account'],
    }))
      expect(paths(input(matches, { ...shared, [key]: value }))).toContain(
        `contributes.domOps[0].params.${key}`,
      );
    expect(
      paths(
        authored({
          matches,
          engine: `>=${resolveEngineVersion('next')}`,
          contributes: {
            settings: {
              backend: {
                type: 'select',
                label: 'Backend',
                default: 'shared',
                options: [{ value: 'shared', label: 'Shared' }],
              },
            },
            domOps: [
              { op: 'native', handler: 'turnNavigator', params: { dataBackend: '{{backend}}' } },
            ],
          },
        }),
      ),
    ).toContain('contributes.domOps[0]');
  });

  describe('primitives handed to official plugins on Gemini and AI Studio', () => {
    const withNative = (matches: string[], handler: string, overrides = {}) =>
      authored({
        engine: '>=1.4.0',
        matches,
        contributes: { domOps: [{ op: 'native', handler, params: {} }] },
        ...overrides,
      });
    const gemini = ['https://gemini.google.com/*'];
    const aistudio = ['https://aistudio.google.com/*'];

    it('accepts formulaCopy on Gemini and AI Studio, and vimInput on Gemini', () => {
      expect(paths(withNative(gemini, 'formulaCopy'))).toEqual([]);
      expect(paths(withNative(aistudio, 'formulaCopy'))).toEqual([]);
      expect(paths(withNative([...gemini, ...aistudio], 'formulaCopy'))).toEqual([]);
      expect(paths(withNative(gemini, 'vimInput'))).toEqual([]);
    });

    it('rejects vimInput on AI Studio, whose Vim mode is not a plugin', () => {
      expect(paths(withNative(aistudio, 'vimInput'))).toEqual(['contributes.domOps[0]']);
    });

    it('requires every target site to allow the primitive', () => {
      expect(paths(withNative(['https://chatgpt.com/*', ...aistudio], 'vimInput'))).toEqual([
        'contributes.domOps[0]',
      ]);
      expect(paths(withNative(['https://chatgpt.com/*', ...gemini], 'vimInput'))).toEqual([]);
    });

    it('still rejects a theme beside an allowed primitive', () => {
      expect(paths(withNative(gemini, 'formulaCopy', { theme: { brand: '#ff0000' } }))).toEqual([
        'theme',
      ]);
    });
  });

  describe("hostPolicy: 'defer' (reading plugins already stored)", () => {
    const defer = { hostPolicy: 'defer' } as const;
    const deferredPaths = (input: unknown): string[] => {
      const result = validateLocalManifest(input, undefined, defer);
      return result.success ? [] : result.error.map((issue) => issue.path);
    };
    const refusedHere = authored({
      engine: '>=1.4.0',
      matches: ['https://aistudio.google.com/*'],
      theme: { brand: '#ff0000' },
      contributes: {
        domOps: [{ op: 'native', handler: 'vimInput', params: {} }],
      },
    });

    it('keeps a record only the site policy refuses, namespaced as on import', () => {
      expect(paths(refusedHere)).toEqual(['theme', 'contributes.domOps[0]']);
      const result = validateLocalManifest(refusedHere, undefined, defer);
      expect(result.success && result.data.manifest.id).toBe('local.me.wide-chat');
    });

    it('defers nothing else: CSS, DOM, params, namespace and site coverage are still checked', () => {
      const rejected = [
        authored({
          matches: ['https://gemini.google.com/*'],
          contributes: { styles: [{ css: 'body{background:url(https://t.example/p.gif)}' }] },
        }),
        authored({
          matches: ['https://gemini.google.com/*'],
          contributes: { domOps: [{ op: 'addClass', target: 'body', className: 'no-prefix' }] },
        }),
        authored({
          matches: ['https://gemini.google.com/*'],
          contributes: {
            domOps: [{ op: 'setAttribute', target: 'body', name: 'onclick', value: 'x' }],
          },
        }),
        authored({
          engine: '>=1.4.0',
          matches: ['https://gemini.google.com/*'],
          contributes: { domOps: [{ op: 'native', handler: 'vimInput', params: { evil: 1 } }] },
        }),
        authored({ id: 'Bad Id', matches: ['https://gemini.google.com/*'] }),
        authored({ tier: 'scripted' }),
        authored({ matches: ['https://example.com/*'] }),
      ];
      for (const input of rejected) {
        expect(deferredPaths(input)).toEqual(paths(input));
        expect(deferredPaths(input).length).toBeGreaterThan(0);
      }
    });
  });

  it('allows a native op only for a shipped primitive with params that fit its contract', () => {
    const native = (handler: string, params: Record<string, unknown>, engine = '>=1.4.0') =>
      authored({
        engine,
        contributes: { domOps: [{ op: 'native', target: 'body', handler, params }] },
      });

    expect(paths(native('vimInput', {}))).toEqual([]);
    expect(paths(native('vimInput', { composer: '#prompt' }))).toEqual([]);
    expect(paths(native('runMyScript', {}))).toContain('requires.handlers');
    expect(paths(native('vimInput', { evil: 'x' }))).toEqual(['contributes.domOps[0].params.evil']);
    expect(paths(native('vimInput', { composer: 42 }))).toEqual([
      'contributes.domOps[0].params.composer',
    ]);
    expect(
      paths(
        native(
          'turnNavigator',
          { accountIdAttributes: ['data-user-id', 'data-workspace-id'] },
          '>=1.5.0',
        ),
      ),
    ).toEqual([]);
    expect(
      paths(native('turnNavigator', { accountIdAttributes: 'data-user-id' }, '>=1.5.0')),
    ).toEqual(['contributes.domOps[0].params.accountIdAttributes']);
    expect(
      paths(native('turnNavigator', { accountIdAttributes: ['data-user-id', 42] }, '>=1.5.0')),
    ).toEqual(['contributes.domOps[0].params.accountIdAttributes']);
    // engine must exclude builds that predate the primitive.
    expect(paths(native('vimInput', {}, '>=1.0.0'))).toEqual(['engine']);
  });
});

describe('validation parity with the remote catalog', () => {
  // Every entry here is rejected by the remote path; the local gate must
  // reject it too (it may reject more, never less).
  const rejectedRemotely: Record<string, Record<string, unknown>> = {
    'external url() in CSS': authored({
      contributes: { styles: [{ css: 'body{background:url(https://t.example/p.gif)}' }] },
    }),
    'a same-origin url() in CSS': authored({
      contributes: { styles: [{ css: "body{background:url('/probe')}" }] },
    }),
    '@import in CSS': authored({
      contributes: { styles: [{ css: '@import url("https://evil.example/x.css");' }] },
    }),
    'a setting default that renders an external url()': authored({
      contributes: {
        settings: { bg: { type: 'string', label: 'Background', default: 'url(https://t.x/p)' } },
        styles: [{ css: 'body{background:{{bg}}}' }],
      },
    }),
    'an unknown op': authored({
      contributes: { domOps: [{ op: 'eval', target: 'body', code: 'alert(1)' }] },
    }),
    'a missing version': authored({ version: undefined }),
  };

  for (const [name, manifest] of Object.entries(rejectedRemotely)) {
    it(`rejects ${name} both remotely and locally`, () => {
      const remote = validateHostCatalogFile(
        { format: 1, host: 'claude.ai', plugins: [manifest] },
        'claude.ai',
      );
      expect(remote?.manifests).toEqual([]);
      expect(remote?.issues.length).toBeGreaterThan(0);
      expect(validateLocalManifest(manifest).success).toBe(false);
    });
  }
});
