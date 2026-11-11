// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app/0123456789abcdef" }
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { isCreationChatText } from '@/features/plugins/local/creation/creationMarker';
import type { LocalPluginRecordMap } from '@/features/plugins/local/localPluginStore';
import { DEFAULT_ADAPTERS } from '@/features/plugins/sites/registry';
import { getTranslationSync } from '@/utils/i18n';

import { checkInstalledCreations, installedFixMessage } from '../creationRequests';

/**
 * jsdom parses a sheet only for a `<style>` in the window's own document and
 * has no `replaceSync`, which browsers use here; this one parses there and
 * copies the rules over, so the check reads real CSSOM rules.
 */
function replaceSync(this: CSSStyleSheet, css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  for (const rule of Array.from(style.sheet?.cssRules ?? [])) {
    this.insertRule(rule.cssText, this.cssRules.length);
  }
  style.remove();
}

beforeAll(() => {
  CSSStyleSheet.prototype.replaceSync = replaceSync;
});
afterAll(() => {
  delete (CSSStyleSheet.prototype as Partial<CSSStyleSheet>).replaceSync;
});

const gemini = DEFAULT_ADAPTERS.find((site) => site.id === 'gemini')!;
const page = () => ({ doc: document, site: gemini, url: location.href });

function restyle(id: string, contributes: Record<string, unknown>, extra = {}) {
  return {
    id,
    name: id,
    version: '1.2.0',
    description: 'd',
    author: 'me',
    category: 'layout',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: ['https://gemini.google.com/*'],
    contributes,
    ...extra,
  };
}

function records(...manifests: Record<string, unknown>[]): LocalPluginRecordMap {
  return Object.fromEntries(
    manifests.map((manifest) => [
      `local.${String(manifest.id)}`,
      {
        manifest: { ...manifest, id: `local.${String(manifest.id)}` },
        importedAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

const verdicts = (map: LocalPluginRecordMap) =>
  Object.fromEntries(
    checkInstalledCreations(page(), map).map((check) => [check.id, check.verdict]),
  );

afterEach(() => {
  document.body.innerHTML = '';
});

describe('which installed restyling creations find anything on this page', () => {
  it('tells a rule that matches from one that matches nothing', () => {
    document.body.innerHTML = '<main><div class="conversation"></div></main>';
    const map = records(
      restyle('hit', { styles: [{ css: '.conversation { max-width: 60rem }' }] }),
      restyle('miss', { styles: [{ css: '.convo-v1 { max-width: 60rem }' }] }),
    );
    expect(verdicts(map)).toEqual({ 'local.hit': 'matches', 'local.miss': 'nothing' });
  });

  it('counts a rule on the page itself, a hover state or one match in a list as found', () => {
    document.body.innerHTML = '<button class="send"></button>';
    const map = records(
      restyle('root', { styles: [{ css: "html[data-gv-scheme='dark'] { color: red }" }] }),
      restyle('hover', { styles: [{ css: '.send:hover::after { content: "" }' }] }),
      restyle('list', { styles: [{ css: '.gone, .send { color: red }' }] }),
      restyle('media', { styles: [{ css: '@media (min-width: 1px) { .send { color: red } }' }] }),
    );
    expect(verdicts(map)).toEqual({
      'local.root': 'matches',
      'local.hover': 'matches',
      'local.list': 'matches',
      'local.media': 'matches',
    });
  });

  it('leaves what matching cannot judge unchecked instead of calling it broken', () => {
    const map = records(
      restyle('keyframes', { styles: [{ css: '@keyframes spin { to { rotate: 1turn } }' }] }),
    );
    expect(verdicts(map)).toEqual({ 'local.keyframes': 'unchecked' });
  });

  it('judges page changes by their targets', () => {
    document.body.innerHTML = '<aside class="promo"></aside>';
    const map = records(
      restyle('hides', { domOps: [{ op: 'hide', target: 'aside.promo' }] }),
      restyle('lost', { domOps: [{ op: 'hide', target: 'aside.banner' }] }),
    );
    expect(verdicts(map)).toEqual({ 'local.hides': 'matches', 'local.lost': 'nothing' });
  });

  it('skips creations for other sites and ones that run code', () => {
    const map = records(
      restyle('claude', { styles: [{ css: '.x{}' }] }, { matches: ['https://claude.ai/*'] }),
      restyle(
        'code',
        { script: { source: 'void 0;' } },
        { tier: 'scripted', matches: ['https://gemini.google.com/*'] },
      ),
    );
    expect(checkInstalledCreations(page(), map)).toEqual([]);
  });
});

describe('the message that asks the AI to fix an installed creation', () => {
  const miss = restyle('miss', {
    styles: [{ css: '.convo-v1 { max-width: 60rem }' }],
    domOps: [{ op: 'hide', target: 'aside.banner' }],
  });

  it('opens a Create chat and says what found nothing, with the plugin as installed and no code fence', () => {
    document.body.innerHTML = '<main><p>`</p></main>';
    const withTick = { ...miss, description: 'uses ``` in text' };
    const message = installedFixMessage(
      page(),
      records(withTick),
      { type: 'gv.create.fix', id: 'local.miss', problem: 'nothing-matches', structure: false },
      getTranslationSync,
    )!;

    expect(isCreationChatText(message)).toBe(true);
    expect(message).toContain('.convo-v1');
    expect(message).toContain('aside.banner (hide)');
    expect(message).toContain('"id": "local.miss"');
    expect(message).not.toContain('```');
    expect(message).not.toContain('Site: Gemini');
  });

  it('adds the page structure when the user keeps it on', () => {
    const message = installedFixMessage(
      page(),
      records(miss),
      { type: 'gv.create.fix', id: 'local.miss', problem: 'nothing-matches', structure: true },
      getTranslationSync,
    )!;
    expect(message).toContain('Site: Gemini');
  });

  it('says a creation froze a page', () => {
    const message = installedFixMessage(
      page(),
      records(miss),
      { type: 'gv.create.fix', id: 'local.miss', problem: 'froze', structure: false },
      getTranslationSync,
    )!;
    expect(message).toContain('never finished loading');
    expect(message).not.toContain('match no element');
  });

  it('has nothing to ask about a creation that is not installed for this page', () => {
    expect(
      installedFixMessage(
        page(),
        records(miss),
        { type: 'gv.create.fix', id: 'local.other', problem: 'froze', structure: false },
        getTranslationSync,
      ),
    ).toBeNull();
  });
});
