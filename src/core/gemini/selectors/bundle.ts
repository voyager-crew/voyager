/**
 * Packaged Gemini locators come from the same fragments the online publisher reads.
 * `selector-data/turn.json` keeps its original lists. The adapter `catalog/sites/gemini/site.json`
 * carries `turn.userWithHosts`/`turn.assistantWithHosts` joined into one string, and
 * `sites/adapters/gemini.parity.test.ts` binds the two; never hand an owner that depends on order
 * the adapter's joined string instead.
 *
 * The turn keys differ on purpose. Each keeps the entries and order its owners used before the
 * lists were merged. Among turn owners, order is behavior in two places:
 * - timeline detection takes the first selector that matches and stores that single string;
 * - highlight concatenates matches selector by selector without re-sorting them.
 * Other owners join their list into one query or CSS rule, or only check that something matches
 * (export's readiness wait), so order does not change what they find. An online patch replaces
 * a list whole, in its own order, and never merges entries.
 */
import activityProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/activity.json';
import canvasCodeProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/canvas-code.json';
import codeProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/code.json';
import composerProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/composer.json';
import contentProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/content.json';
import contextImageProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/context-images.json';
import gemsProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/gems.json';
import generatedImageProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/generated-image.json';
import imageExportProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/image-export.json';
import inputCollapseProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/input-collapse.json';
import exportOverlayProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/menu-overlay.json';
import menuProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/menu.json';
import modelPickerProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/model-picker.json';
import projectProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/project.json';
import promptHistoryProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/prompt-history.json';
import researchPackProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/research-pack.json';
import responseActionProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/response-actions.json';
import sentChipsProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/sent-chips.json';
import sidebarHoverProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/sidebar-hover.json';
import sidebarWidthProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/sidebar-width.json';
import sidebarProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/sidebar.json';
import slashProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/slash.json';
import turnProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/turn.json';
import usageProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/usage.json';
import userLatexProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/user-latex.json';
import vimProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/vim.json';

import { GEMINI_ACTIVITY_PROFILE_KEYS } from './activityKeys';
import { GEMINI_CANVAS_CODE_PROFILE_KEYS } from './canvasKeys';
import { GEMINI_CODE_PROFILE_KEYS } from './codeKeys';
import { GEMINI_COMPOSER_PROFILE_KEYS } from './composerKeys';
import { GEMINI_CONTENT_PROFILE_KEYS, GEMINI_CONTEXT_IMAGE_PROFILE_KEYS } from './contentKeys';
import { GEMINI_GEMS_PROFILE_KEYS } from './gemsKeys';
import { GEMINI_GENERATED_IMAGE_PROFILE_KEYS } from './generatedImageKeys';
import { GEMINI_IMAGE_EXPORT_PROFILE_KEYS } from './imageExportKeys';
import { GEMINI_INPUT_COLLAPSE_PROFILE_KEYS } from './inputCollapseKeys';
import { GEMINI_USER_LATEX_PROFILE_KEYS } from './mathKeys';
import { GEMINI_MENU_PROFILE_KEYS, GEMINI_EXPORT_OVERLAY_PROFILE_KEYS } from './menuKeys';
import { GEMINI_MODEL_PICKER_PROFILE_KEYS } from './modelPickerKeys';
import { GEMINI_PROJECT_PROFILE_KEYS } from './projectKeys';
import {
  GEMINI_PROMPT_HISTORY_PROFILE_KEYS,
  GEMINI_SENT_CHIPS_PROFILE_KEYS,
  GEMINI_SLASH_PROFILE_KEYS,
} from './promptKeys';
import {
  GEMINI_RESPONSE_ACTION_PROFILE_KEYS,
  GEMINI_RESEARCH_PACK_PROFILE_KEYS,
} from './responseSurfaceKeys';
import {
  GEMINI_SIDEBAR_WIDTH_PROFILE_KEYS,
  GEMINI_SIDEBAR_HOVER_PROFILE_KEYS,
} from './sidebarInteractionKeys';
import { GEMINI_SIDEBAR_PROFILE_KEYS } from './sidebarKeys';
import {
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiSelectorProfileKey,
  type GeminiSelectorProfiles,
  type GeminiSelectorView,
  type GeminiTurnView,
} from './types';
import { GEMINI_USAGE_PROFILE_KEYS } from './usageKeys';
import { readGeminiSelectorProfiles, readGeminiSelectorProfileGroup } from './validation';
import { GEMINI_VIM_PROFILE_KEYS } from './vimKeys';

function readGroup<Key extends GeminiSelectorProfileKey>(
  value: unknown,
  keys: readonly Key[],
  name: string,
): Readonly<Record<Key, readonly string[]>> {
  const profiles = readGeminiSelectorProfileGroup(value, keys);
  if (!profiles) throw new Error(`Invalid bundled Gemini ${name} profiles`);
  return profiles;
}

function readBundle(): GeminiSelectorProfiles {
  const profiles = {
    ...readGroup(turnProfiles, GEMINI_TURN_PROFILE_KEYS, 'turn'),
    ...readGroup(sidebarProfiles, GEMINI_SIDEBAR_PROFILE_KEYS, 'sidebar'),
    ...readGroup(modelPickerProfiles, GEMINI_MODEL_PICKER_PROFILE_KEYS, 'model picker'),
    ...readGroup(composerProfiles, GEMINI_COMPOSER_PROFILE_KEYS, 'composer'),
    ...readGroup(inputCollapseProfiles, GEMINI_INPUT_COLLAPSE_PROFILE_KEYS, 'input-collapse'),
    ...readGroup(vimProfiles, GEMINI_VIM_PROFILE_KEYS, 'vim'),
    ...readGroup(promptHistoryProfiles, GEMINI_PROMPT_HISTORY_PROFILE_KEYS, 'prompt-history'),
    ...readGroup(slashProfiles, GEMINI_SLASH_PROFILE_KEYS, 'slash'),
    ...readGroup(sentChipsProfiles, GEMINI_SENT_CHIPS_PROFILE_KEYS, 'sent-chips'),
    ...readGroup(projectProfiles, GEMINI_PROJECT_PROFILE_KEYS, 'project'),
    ...readGroup(activityProfiles, GEMINI_ACTIVITY_PROFILE_KEYS, 'activity'),
    ...readGroup(gemsProfiles, GEMINI_GEMS_PROFILE_KEYS, 'gems'),
    ...readGroup(sidebarHoverProfiles, GEMINI_SIDEBAR_HOVER_PROFILE_KEYS, 'sidebar-hover'),
    ...readGroup(sidebarWidthProfiles, GEMINI_SIDEBAR_WIDTH_PROFILE_KEYS, 'sidebar-width'),
    ...readGroup(exportOverlayProfiles, GEMINI_EXPORT_OVERLAY_PROFILE_KEYS, 'menu-overlay'),
    ...readGroup(menuProfiles, GEMINI_MENU_PROFILE_KEYS, 'menu'),
    ...readGroup(contentProfiles, GEMINI_CONTENT_PROFILE_KEYS, 'content'),
    ...readGroup(contextImageProfiles, GEMINI_CONTEXT_IMAGE_PROFILE_KEYS, 'context-images'),
    ...readGroup(responseActionProfiles, GEMINI_RESPONSE_ACTION_PROFILE_KEYS, 'response-actions'),
    ...readGroup(researchPackProfiles, GEMINI_RESEARCH_PACK_PROFILE_KEYS, 'research-pack'),
    ...readGroup(usageProfiles, GEMINI_USAGE_PROFILE_KEYS, 'usage'),
    ...readGroup(codeProfiles, GEMINI_CODE_PROFILE_KEYS, 'code'),
    ...readGroup(userLatexProfiles, GEMINI_USER_LATEX_PROFILE_KEYS, 'user-latex'),
    ...readGroup(imageExportProfiles, GEMINI_IMAGE_EXPORT_PROFILE_KEYS, 'image-export'),
    ...readGroup(generatedImageProfiles, GEMINI_GENERATED_IMAGE_PROFILE_KEYS, 'generated-image'),
    ...readGroup(canvasCodeProfiles, GEMINI_CANVAS_CODE_PROFILE_KEYS, 'canvas-code'),
  };
  const validated = readGeminiSelectorProfiles(profiles);
  if (!validated) throw new Error('Combined bundled Gemini profiles exceed the shared contract');
  return validated as GeminiSelectorProfiles;
}

const BUNDLED_VIEW: GeminiSelectorView = Object.freeze({
  profiles: readBundle(),
  remoteKeys: new Set<never>(),
  revision: null,
});

export function getBundledGeminiSelectorView(): GeminiSelectorView {
  return BUNDLED_VIEW;
}

export function getBundledGeminiTurnView(): GeminiTurnView {
  return BUNDLED_VIEW;
}

export function getGeminiBundledRevision(): number {
  const value = Number(import.meta.env.VOYAGER_CATALOG_REVISION);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
