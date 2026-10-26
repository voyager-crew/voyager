import { getBundledGeminiSelectorView } from '../gemini/selectors/bundle';
import { AISTUDIO_SURFACE_PROFILES } from './contracts/aistudioSurfaces';
import { CHATGPT_ACTION_PROFILES } from './contracts/chatgptActions';
import { EXPORT_PROFILES } from './contracts/export';
import { INPUT_SITE_PROFILES } from './contracts/inputSurfaces';
import { BUNDLED_LOCATOR_SITES, bundledSemanticProfiles } from './sites';
import type { SiteSelectorView } from './types';
import { readBundledSelectorProfiles } from './validation';

const SURFACE_PROFILES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  aistudio: { ...INPUT_SITE_PROFILES.aistudio, ...AISTUDIO_SURFACE_PROFILES },
  chatgpt: {
    ...INPUT_SITE_PROFILES.chatgpt,
    ...EXPORT_PROFILES.chatgpt,
    ...CHATGPT_ACTION_PROFILES,
  },
  claude: { ...INPUT_SITE_PROFILES.claude, ...EXPORT_PROFILES.claude },
  deepseek: { ...INPUT_SITE_PROFILES.deepseek, ...EXPORT_PROFILES.deepseek },
  kimi: { ...INPUT_SITE_PROFILES.kimi, ...EXPORT_PROFILES.kimi },
};

function readBundle(siteId: string): SiteSelectorView {
  if (siteId === 'gemini') return getBundledGeminiSelectorView();
  const profiles = readBundledSelectorProfiles(SURFACE_PROFILES[siteId]);
  if (!profiles) throw new Error(`Invalid bundled locator profiles: ${siteId}`);
  return Object.freeze({
    siteId,
    profiles: Object.freeze({ ...bundledSemanticProfiles(siteId), ...profiles }),
    remoteKeys: new Set<string>(),
    revision: null,
  });
}

const BUNDLED_VIEWS: Readonly<Record<string, SiteSelectorView>> = Object.freeze(
  Object.fromEntries(BUNDLED_LOCATOR_SITES.map((site) => [site.id, readBundle(site.id)])),
);

export function getBundledSiteSelectorView(siteId: string): SiteSelectorView {
  const view = Object.hasOwn(BUNDLED_VIEWS, siteId) ? BUNDLED_VIEWS[siteId] : undefined;
  if (!view) throw new Error(`Unknown catalog locator site: ${siteId}`);
  return view;
}

export { getSiteBundledRevision } from './revision';
