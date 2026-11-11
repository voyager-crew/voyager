import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { TranslationKey } from '@/utils/translations';

import { EFFECTIVE_PLUGIN_ENGINE_VERSION } from '../verbs/contracts';
import { inlinesCreatePage } from './authoring/inlineCreatePage';
import { WRITE_PLUGIN_SKILL_URL, createPageFile, createPageUrl } from './authoring/skillLink';
import { MAX_PLUGIN_REQUEST_CHARS, authoringSites } from './authoringSites';
import { isCreationChatText } from './creation/creationMarker';
import { PLUGIN_CHECK_COMMAND, buildAgentHandoff, buildCreationMessage } from './creationMessage';

const LOCALES_DIR = join(process.cwd(), 'src/locales');
const locales = readdirSync(LOCALES_DIR).map((locale) => {
  const messages = JSON.parse(
    readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf8'),
  ) as Record<string, { message: string }>;
  const t = (key: TranslationKey) => messages[key]?.message ?? key;
  return [locale, t] as const;
});
const english = locales.find(([locale]) => locale === 'en')![1];
const sites = authoringSites();
const claude = sites.find((site) => site.id === 'claude')!;
const gemini = sites.find((site) => site.id === 'gemini')!;
const linkedSites = sites.filter((site) => !inlinesCreatePage(site.id));

// Text a template engine would treat as a placeholder or a replacement pattern.
const TRICKY_REQUEST = 'Show {engine} and $& in a badge on {site}';

describe('creation message', () => {
  it.each(sites.map((site) => [site.label, site] as const))(
    'points the chat AI on %s at its own page',
    (_label, site) => {
      const message = buildCreationMessage('Round my messages', site, english);
      expect(message).toContain(createPageUrl(site.id));
      expect(message).toContain(site.label);
    },
  );

  it.each(locales)(
    'carries the request verbatim, the engine and the reply format in %s, in under 500 more characters',
    (_locale, t) => {
      const message = buildCreationMessage(`  ${TRICKY_REQUEST}\n`, claude, t);
      expect(message.endsWith(`\n${TRICKY_REQUEST}`)).toBe(true);
      const wrapper = message.slice(0, -TRICKY_REQUEST.length);
      expect(wrapper).toContain(EFFECTIVE_PLUGIN_ENGINE_VERSION);
      expect(wrapper).toContain('json');
      expect(wrapper).not.toMatch(/\{\w+\}/);
      expect(wrapper.length).toBeLessThan(500);
    },
  );

  it.each(
    locales.flatMap(([locale, t]) =>
      linkedSites.map((site) => [locale, site.label, site, t] as const),
    ),
  )(
    'links the page in %s on %s, the message unchanged since links were the only form',
    (_locale, _label, site, t) => {
      const expected = t('createModeChatMessage')
        .split('{pageUrl}')
        .join(createPageUrl(site.id))
        .split('{site}')
        .join(site.label)
        .split('{engine}')
        .join(EFFECTIVE_PLUGIN_ENGINE_VERSION)
        .split('{request}')
        .join(TRICKY_REQUEST);
      expect(buildCreationMessage(TRICKY_REQUEST, site, t)).toBe(expected);
    },
  );

  // The create page writes name and description in the language the message names.
  const UI_LANGUAGE: Readonly<Record<string, string>> = {
    en: 'English',
    zh: '简体中文',
    zh_TW: '繁體中文',
    ja: '日本語',
    ko: '한국어',
    fr: 'français',
    es: 'español',
    pt: 'português',
    ru: 'русском',
    ar: 'بالعربية',
  };

  it.each(locales)('names the Voyager UI language in %s, on every site', (locale, t) => {
    expect(UI_LANGUAGE[locale], `add ${locale} to UI_LANGUAGE`).toBeDefined();
    for (const site of sites) {
      const message = buildCreationMessage(TRICKY_REQUEST, site, t);
      const [wrapper] = message.split('\n\n');
      expect(wrapper, site.id).toContain(UI_LANGUAGE[locale]);
    }
  });

  it('keeps no more of the request than the composer field accepts', () => {
    const request = 'x'.repeat(MAX_PLUGIN_REQUEST_CHARS + 50);
    const message = buildCreationMessage(request, claude, english);
    expect(message).toContain('x'.repeat(MAX_PLUGIN_REQUEST_CHARS));
    expect(message).not.toContain('x'.repeat(MAX_PLUGIN_REQUEST_CHARS + 1));
  });
});

describe('creation message on a site whose AI cannot open links', () => {
  const page = readFileSync(
    join(process.cwd(), 'docs/public/create', createPageFile(gemini.id)),
    'utf8',
  );
  const request = `${TRICKY_REQUEST} and {page} and {request}`;

  it('is Gemini, and only Gemini', () => {
    expect(sites.filter((site) => inlinesCreatePage(site.id)).map((site) => site.id)).toEqual([
      'gemini',
    ]);
  });

  it.each(locales)(
    'carries the published page, then the request verbatim and last, in %s',
    (_locale, t) => {
      const message = buildCreationMessage(`  ${request}\n`, gemini, t);
      expect(message.endsWith(`\n${request}`)).toBe(true);
      const wrapper = message.slice(0, -request.length);
      expect(wrapper.split(page)).toHaveLength(2);
      const [intro, outro] = wrapper.split(page);
      expect(intro).toContain(EFFECTIVE_PLUGIN_ENGINE_VERSION);
      expect(intro).toContain('json');
      expect(intro).toContain(gemini.label);
      expect(intro).toContain(createPageUrl(gemini.id));
      expect(`${intro}${outro}`).not.toMatch(/\{\w+\}/);
      expect(outro.length).toBeLessThan(100);
      expect(isCreationChatText(message)).toBe(true);
    },
  );
});

describe('text Voyager places in a composer', () => {
  // ChatGPT's composer turns ``` into a code box that swallows the rest of the message.
  it.each(locales)('holds no triple backtick in %s', (_locale, t) => {
    for (const site of sites) {
      expect(buildCreationMessage(TRICKY_REQUEST, site, t), site.id).not.toContain('```');
    }
    expect(t('createModeFixIntro')).not.toContain('```');
  });
});

describe('agent handoff', () => {
  it.each(locales)(
    'names the site, skill, engine, check and files to hand back in %s',
    (_locale, t) => {
      const handoff = buildAgentHandoff(TRICKY_REQUEST, claude, t);
      expect(handoff.endsWith(`\n${TRICKY_REQUEST}`)).toBe(true);
      expect(handoff).toContain(claude.label);
      expect(handoff).toContain(WRITE_PLUGIN_SKILL_URL);
      expect(handoff).toContain(EFFECTIVE_PLUGIN_ENGINE_VERSION);
      expect(handoff).toContain(`\`${PLUGIN_CHECK_COMMAND}\``);
      expect(handoff).toContain('plugin.json');
      expect(handoff).toContain('style.css');
      expect(handoff).toContain(t('localPluginsImportFiles'));
    },
  );
});
