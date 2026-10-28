import { describe, expect, it } from 'vitest';

import manifest from '../../../../manifest.json';
import type { PluginManifest } from '../types';
import { listPrimitiveNames } from '../verbs/registry';
import { aistudioAdapter } from './adapters/aistudio';
import { chatgptAdapter } from './adapters/chatgpt';
import { geminiAdapter } from './adapters/gemini';
import { OFFICIAL_PLUGIN_IDS } from './featureOwners';
import {
  PACKAGED_HOST_POLICIES,
  allowedPrimitivesForSite,
  allowsNativeHandler,
  allowsPluginTheme,
  allowsPluginThemeForSite,
  hostPolicyRefusal,
  isStaticallyInjectedHost,
  manifestHostPolicyIssues,
  nativeStartPointSiteForHost,
  packagedSiteForUrl,
  usesCatalogDataStores,
} from './hostPolicy';
import { sharedTimelineAdmissionId } from './sharedTimelinePolicy';

const PACKAGED_HOSTS = [
  'gemini.google.com',
  'business.gemini.google',
  'aistudio.google.com',
  'aistudio.google.cn',
];

type Contributes = PluginManifest['contributes'];

function plugin(
  matches: string[],
  contributes: Contributes,
  theme?: PluginManifest['theme'],
): Pick<PluginManifest, 'matches' | 'theme' | 'contributes'> {
  return { matches, contributes, ...(theme ? { theme } : {}) };
}

const nativeOp = (handler: string) => ({ op: 'native' as const, handler, params: {} });
const hideOp = { op: 'hide' as const, target: { kind: 'css' as const, selector: '.x' } };

describe('packaged host policy', () => {
  it('covers exactly the hosts the manifest injects the main content script into and grants', () => {
    const contentScript = manifest.content_scripts.find((script) =>
      script.js.includes('src/pages/content/index.tsx'),
    );
    const policyMatches = PACKAGED_HOST_POLICIES.flatMap((policy) => policy.matches);
    expect([...(contentScript?.matches ?? [])].sort()).toEqual([...policyMatches].sort());
    for (const pattern of policyMatches) {
      expect(manifest.host_permissions).toContain(pattern);
    }
  });

  it('recognizes the statically injected hosts and nothing else', () => {
    for (const host of PACKAGED_HOSTS) {
      expect(isStaticallyInjectedHost(host)).toBe(true);
      expect(isStaticallyInjectedHost(host.toUpperCase())).toBe(true);
    }
    expect(isStaticallyInjectedHost(' aistudio.google.cn ')).toBe(true);
    expect(isStaticallyInjectedHost('claude.ai')).toBe(false);
    expect(isStaticallyInjectedHost('google.com')).toBe(false);
  });

  it('normalizes native host answers consistently with static injection', () => {
    for (const [host, nativeSite] of [
      ['gemini.google.com', 'gemini'],
      ['business.gemini.google', null],
      ['aistudio.google.com', 'aistudio'],
      ['aistudio.google.cn', 'aistudio'],
    ] as const) {
      for (const input of [host, host.toUpperCase(), ` ${host} `, ` ${host.toUpperCase()} `]) {
        expect(isStaticallyInjectedHost(input)).toBe(true);
        expect(nativeStartPointSiteForHost(input)).toBe(nativeSite);
      }
    }
    expect(nativeStartPointSiteForHost('claude.ai')).toBeNull();
  });

  it.each([
    'gemini.google.com.example.com',
    'xgemini.google.com',
    'aistudio.google.com.evil.test',
    'business.gemini.google.example.com',
    'aistudio.google.cn.example.com',
  ])('does not treat the lookalike %s as a packaged host', (host) => {
    expect(isStaticallyInjectedHost(host)).toBe(false);
    expect(nativeStartPointSiteForHost(host)).toBeNull();
    expect(packagedSiteForUrl(`https://${host}/`)).toBeNull();
  });

  it('keeps native themes packaged while catalog sites can supply a theme', () => {
    for (const host of PACKAGED_HOSTS) {
      expect(allowsPluginTheme(`https://${host}/app`)).toBe(false);
    }
    expect(allowsPluginTheme('https://chatgpt.com/c/1')).toBe(true);
  });

  it('judges a page by its real hostname, not by text in the URL', () => {
    expect(packagedSiteForUrl('https://gemini.google.com/app/abc')).toBe('gemini');
    expect(packagedSiteForUrl('https://business.gemini.google/u/1/')).toBe('gemini');
    expect(packagedSiteForUrl('https://AISTUDIO.google.com/prompts/new_chat')).toBe('aistudio');
    expect(packagedSiteForUrl('https://gemini.google.com.evil.test/')).toBeNull();
    expect(packagedSiteForUrl('https://evil.test/?next=https://gemini.google.com/')).toBeNull();
    expect(packagedSiteForUrl('not a url')).toBeNull();
  });

  it('keeps catalog data stores off the packaged sites by id', () => {
    expect(usesCatalogDataStores('gemini')).toBe(false);
    expect(usesCatalogDataStores('aistudio')).toBe(false);
    for (const site of ['chatgpt', 'claude', 'deepseek']) {
      expect(usesCatalogDataStores(site)).toBe(true);
    }
  });

  it('opens on Gemini and AI Studio only the primitives their official plugins now own', () => {
    const geminiOpen = new Set([
      'formulaCopy',
      'vimInput',
      'userLatex',
      'codeCollapse',
      'wavedrom',
      'echarts',
      'mermaid',
      'sendShortcut',
      'draftSave',
      'turnNavigator',
      'folders',
      'siteCheck',
    ]);
    const aistudioOpen = new Set(['formulaCopy', 'sendShortcut', 'folders', 'siteCheck']);
    const primitives = listPrimitiveNames();
    expect(primitives).toEqual(expect.arrayContaining([...geminiOpen]));
    for (const handler of primitives) {
      expect(allowsNativeHandler('gemini', handler)).toBe(geminiOpen.has(handler));
      expect(allowsNativeHandler('aistudio', handler)).toBe(aistudioOpen.has(handler));
      expect(allowsNativeHandler('chatgpt', handler)).toBe(true);
    }
    expect(allowedPrimitivesForSite(geminiAdapter)).toEqual(geminiOpen);
    expect(allowedPrimitivesForSite(aistudioAdapter)).toEqual(aistudioOpen);
    expect(allowedPrimitivesForSite(chatgptAdapter)).toBe('all');
  });

  it('forbids a theme on a site adapter that reaches a packaged site', () => {
    expect(allowsPluginThemeForSite(geminiAdapter)).toBe(false);
    expect(allowsPluginThemeForSite(aistudioAdapter)).toBe(false);
    expect(allowsPluginThemeForSite(chatgptAdapter)).toBe(true);
  });
});

describe('manifestHostPolicyIssues', () => {
  it('passes CSS and reversible DOM ops on the packaged sites, and anything elsewhere', () => {
    expect(
      manifestHostPolicyIssues(plugin(['https://gemini.google.com/*'], { domOps: [hideOp] })),
    ).toEqual([]);
    expect(
      manifestHostPolicyIssues(
        plugin(['https://claude.ai/*'], { domOps: [nativeOp('vimInput')] }, { brand: '#ff0000' }),
      ),
    ).toEqual([]);
  });

  it('reports a theme once, whatever number of packaged sites the plugin targets', () => {
    const issues = manifestHostPolicyIssues(
      plugin(
        ['https://gemini.google.com/*', 'https://aistudio.google.com/*'],
        {},
        { brand: '#ff0000' },
      ),
    );
    expect(issues).toEqual([
      {
        path: 'theme',
        message: 'Gemini and AI Studio keep Voyager’s own accent: remove theme for these sites',
      },
    ]);
  });

  it('passes an opened primitive on every packaged site that opened it', () => {
    expect(
      manifestHostPolicyIssues(
        plugin(['https://gemini.google.com/*', 'https://aistudio.google.com/*'], {
          domOps: [nativeOp('formulaCopy')],
        }),
      ),
    ).toEqual([]);
    expect(
      manifestHostPolicyIssues(
        plugin(['https://gemini.google.com/app/*'], { domOps: [nativeOp('vimInput')] }),
      ),
    ).toEqual([]);
  });

  it('checks each target site on its own: one refusing site is enough', () => {
    const issues = manifestHostPolicyIssues(
      plugin(['https://chatgpt.com/*', 'https://aistudio.google.com/*'], {
        domOps: [hideOp, nativeOp('vimInput')],
      }),
    );
    expect(issues).toEqual([
      {
        path: 'contributes.domOps[1]',
        message: 'the `vimInput` primitive is not available on AI Studio in this Voyager version',
      },
    ]);
  });

  it('reports a native op once for every packaged site that refuses it', () => {
    const issues = manifestHostPolicyIssues(
      plugin(['https://gemini.google.com/*', 'https://aistudio.google.cn/*'], {
        domOps: [nativeOp('turnNavigator'), nativeOp('vimInput')],
      }),
    );
    expect(issues).toEqual([
      {
        path: 'contributes.domOps[0]',
        message: 'Gemini turnNavigator requires literal params.dataBackend: "shared"',
      },
      {
        path: 'contributes.domOps[0]',
        message:
          'the `turnNavigator` primitive is not available on AI Studio in this Voyager version',
      },
      {
        path: 'contributes.domOps[1]',
        message: 'the `vimInput` primitive is not available on AI Studio in this Voyager version',
      },
    ]);
  });
});

describe('hostPolicyRefusal', () => {
  it('refuses a theme or a kept primitive on a packaged page, naming each refused handler once', () => {
    expect(
      hostPolicyRefusal('https://gemini.google.com/app', plugin([], {}, { brand: '#ff0000' })),
    ).toEqual({ kind: 'theme' });
    expect(
      hostPolicyRefusal(
        'https://aistudio.google.com/prompts/1',
        plugin([], {
          domOps: [
            nativeOp('turnNavigator'),
            nativeOp('formulaCopy'),
            hideOp,
            nativeOp('vimInput'),
            nativeOp('turnNavigator'),
          ],
        }),
      ),
    ).toEqual({ kind: 'native-op', handlers: ['turnNavigator', 'vimInput'] });
  });

  it('lets an opened primitive run on its own packaged page', () => {
    const formula = plugin([], { domOps: [nativeOp('formulaCopy')] });
    const vim = plugin([], { domOps: [nativeOp('vimInput')] });
    expect(hostPolicyRefusal('https://gemini.google.com/app', formula)).toBeNull();
    expect(hostPolicyRefusal('https://gemini.google.com/app', vim)).toBeNull();
    expect(hostPolicyRefusal('https://aistudio.google.cn/', formula)).toBeNull();
    expect(hostPolicyRefusal('https://aistudio.google.cn/', vim)).toEqual({
      kind: 'native-op',
      handlers: ['vimInput'],
    });
    const shared = plugin(['https://gemini.google.com/*'], {
      domOps: [{ op: 'native', handler: 'turnNavigator', params: { dataBackend: 'shared' } }],
    });
    const route = 'https://gemini.google.com/u/2/gem/custom/chat';
    expect(manifestHostPolicyIssues(shared)).toEqual([]);
    expect(hostPolicyRefusal(route, shared)).toBeNull();
    expect(sharedTimelineAdmissionId(route, shared)).toBe(OFFICIAL_PLUGIN_IDS.geminiTimeline);
    expect(hostPolicyRefusal('https://business.gemini.google/app/chat', shared)).toEqual({
      kind: 'native-op',
      handlers: ['turnNavigator'],
    });
    expect(sharedTimelineAdmissionId('https://business.gemini.google/app/chat', shared)).toBeNull();
  });

  it('keeps stored shared rails from selecting catalog data, mixed sites or plugin-authored identity', () => {
    const sharedOp = {
      op: 'native' as const,
      handler: 'turnNavigator',
      params: { dataBackend: 'shared' },
    };
    const refused = { kind: 'native-op', handlers: ['turnNavigator'] };
    for (const matches of [
      ['https://business.gemini.google/*'],
      ['https://gemini.google.com/*', 'https://claude.ai/*'],
      ['https://gemini.google.com/*', 'https://business.gemini.google/*'],
      ['https://claude.ai/*'],
    ]) {
      const shared = plugin(matches, { domOps: [sharedOp] });
      expect(manifestHostPolicyIssues(shared).length).toBeGreaterThan(0);
      expect(hostPolicyRefusal('https://gemini.google.com/app/chat', shared)).toEqual(refused);
      expect(hostPolicyRefusal('https://claude.ai/chat/a', shared)).toEqual(refused);
      expect(sharedTimelineAdmissionId('https://gemini.google.com/app/chat', shared)).toBeNull();
    }
    const nativeOnly = plugin(['https://gemini.google.com/*'], {
      domOps: [nativeOp('turnNavigator')],
    });
    expect(hostPolicyRefusal('https://gemini.google.com/app/chat', nativeOnly)).toEqual(refused);
    for (const [key, value] of Object.entries({
      turn: '.fake',
      turnItem: '.fake',
      conversationIdPattern: '^/app/(.+)',
      conversationIdAttribute: 'data-conversation',
      accountIdAttributes: ['data-account'],
    })) {
      const shared = plugin(['https://gemini.google.com/*'], {
        domOps: [{ ...sharedOp, params: { ...sharedOp.params, [key]: value } }],
      });
      expect(manifestHostPolicyIssues(shared)).toContainEqual(
        expect.objectContaining({ path: `contributes.domOps[0].params.${key}` }),
      );
      expect(hostPolicyRefusal('https://gemini.google.com/u/1/app/chat', shared)).toEqual(refused);
      expect(
        sharedTimelineAdmissionId('https://gemini.google.com/u/1/app/chat', shared),
      ).toBeNull();
    }
    expect(
      sharedTimelineAdmissionId(
        'https://gemini.google.com/app/chat',
        plugin(['https://gemini.google.com/*'], { domOps: [hideOp] }),
      ),
    ).toBeNull();
    expect(
      hostPolicyRefusal(
        'https://claude.ai/chat/a',
        plugin(['https://claude.ai/*'], { domOps: [nativeOp('turnNavigator')] }),
      ),
    ).toBeNull();
  });

  it('refuses nothing for CSS-only plugins or on other sites', () => {
    expect(
      hostPolicyRefusal('https://gemini.google.com/app', plugin([], { domOps: [hideOp] })),
    ).toBeNull();
    expect(
      hostPolicyRefusal(
        'https://claude.ai/new',
        plugin([], { domOps: [nativeOp('vimInput')] }, { brand: '#ff0000' }),
      ),
    ).toBeNull();
  });
});
