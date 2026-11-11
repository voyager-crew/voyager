/**
 * The two texts Create mode hands to an AI on the user's behalf. The user sees
 * both in their own composer or clipboard, so the wrapper sentences come from
 * the user's locale; the request, URLs, Voyager version and command are
 * interpolated untranslated.
 *
 * - `buildCreationMessage`: for the chat AI on the site the plugin targets. It
 *   points at that site's chat page (`authoring/createPages.ts`) instead of
 *   carrying the contract, except on a site whose chat AI cannot open a link
 *   (`authoring/inlineCreatePage.ts`): there it carries the page, then the
 *   request.
 * - `buildAgentHandoff`: for a local coding agent, which follows the public
 *   skill and checks its files offline before handing them back.
 */
import type { TranslationKey } from '@/utils/translations';

import type { SiteAdapter } from '../types';
import { EFFECTIVE_PLUGIN_ENGINE_VERSION } from '../verbs/contracts';
import { renderCreatePage } from './authoring/createPages';
import { inlinesCreatePage } from './authoring/inlineCreatePage';
import { PLUGIN_CLI_PACKAGE, WRITE_PLUGIN_SKILL_URL, createPageUrl } from './authoring/skillLink';
import { MAX_PLUGIN_REQUEST_CHARS } from './authoringSites';

type Translate = (key: TranslationKey) => string;

export const PLUGIN_CHECK_COMMAND = `npx ${PLUGIN_CLI_PACKAGE}@latest check <plugin folder>`;

/** One pass over `{name}` placeholders, so text substituted in (the request) is never rescanned. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? values[name] : placeholder,
  );
}

function requestText(request: string): string {
  return request.trim().slice(0, MAX_PLUGIN_REQUEST_CHARS);
}

/** The message Voyager places in the chat composer of `site`. */
export function buildCreationMessage(request: string, site: SiteAdapter, t: Translate): string {
  const values = {
    pageUrl: createPageUrl(site.id),
    site: site.label,
    engine: EFFECTIVE_PLUGIN_ENGINE_VERSION,
    request: requestText(request),
  };
  if (!inlinesCreatePage(site.id)) return fill(t('createModeChatMessage'), values);
  return fill(t('createModeChatMessageInline'), { ...values, page: renderCreatePage(site) });
}

/** The text the user copies to a local coding agent to write a plugin for `site`. */
export function buildAgentHandoff(request: string, site: SiteAdapter, t: Translate): string {
  return fill(t('createModeAgentHandoff'), {
    site: site.label,
    skillUrl: WRITE_PLUGIN_SKILL_URL,
    engine: EFFECTIVE_PLUGIN_ENGINE_VERSION,
    checkCommand: PLUGIN_CHECK_COMMAND,
    importFiles: t('localPluginsImportFiles'),
    request: requestText(request),
  });
}
