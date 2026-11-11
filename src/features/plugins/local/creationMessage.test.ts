import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { TranslationKey } from '@/utils/translations';

import { EFFECTIVE_PLUGIN_ENGINE_VERSION } from '../verbs/contracts';
import { WRITE_PLUGIN_SKILL_URL, createPageUrl } from './authoring/skillLink';
import { MAX_PLUGIN_REQUEST_CHARS, authoringSites } from './authoringSites';
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
      expect(wrapper).toContain('```json');
      expect(wrapper).not.toMatch(/\{\w+\}/);
      expect(wrapper.length).toBeLessThan(500);
    },
  );

  it('keeps no more of the request than the composer field accepts', () => {
    const request = 'x'.repeat(MAX_PLUGIN_REQUEST_CHARS + 50);
    const message = buildCreationMessage(request, claude, english);
    expect(message).toContain('x'.repeat(MAX_PLUGIN_REQUEST_CHARS));
    expect(message).not.toContain('x'.repeat(MAX_PLUGIN_REQUEST_CHARS + 1));
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
