import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GEMINI_ACTIVITY_PROFILE_KEYS } from '../../src/core/gemini/selectors/activityKeys';
import { GEMINI_CANVAS_CODE_PROFILE_KEYS } from '../../src/core/gemini/selectors/canvasKeys';
import { GEMINI_CODE_PROFILE_KEYS } from '../../src/core/gemini/selectors/codeKeys';
import { GEMINI_COMPOSER_PROFILE_KEYS } from '../../src/core/gemini/selectors/composerKeys';
import {
  GEMINI_CONTENT_PROFILE_KEYS,
  GEMINI_CONTEXT_IMAGE_PROFILE_KEYS,
} from '../../src/core/gemini/selectors/contentKeys';
import { GEMINI_GEMS_PROFILE_KEYS } from '../../src/core/gemini/selectors/gemsKeys';
import { GEMINI_GENERATED_IMAGE_PROFILE_KEYS } from '../../src/core/gemini/selectors/generatedImageKeys';
import { GEMINI_IMAGE_EXPORT_PROFILE_KEYS } from '../../src/core/gemini/selectors/imageExportKeys';
import { GEMINI_INPUT_COLLAPSE_PROFILE_KEYS } from '../../src/core/gemini/selectors/inputCollapseKeys';
import { GEMINI_USER_LATEX_PROFILE_KEYS } from '../../src/core/gemini/selectors/mathKeys';
import {
  GEMINI_MENU_PROFILE_KEYS,
  GEMINI_EXPORT_OVERLAY_PROFILE_KEYS,
} from '../../src/core/gemini/selectors/menuKeys';
import { GEMINI_MODEL_PICKER_PROFILE_KEYS } from '../../src/core/gemini/selectors/modelPickerKeys';
import { GEMINI_PROJECT_PROFILE_KEYS } from '../../src/core/gemini/selectors/projectKeys';
import {
  GEMINI_PROMPT_HISTORY_PROFILE_KEYS,
  GEMINI_SLASH_PROFILE_KEYS,
  GEMINI_SENT_CHIPS_PROFILE_KEYS,
} from '../../src/core/gemini/selectors/promptKeys';
import {
  GEMINI_RESPONSE_ACTION_PROFILE_KEYS,
  GEMINI_RESEARCH_PACK_PROFILE_KEYS,
} from '../../src/core/gemini/selectors/responseSurfaceKeys';
import {
  GEMINI_SIDEBAR_WIDTH_PROFILE_KEYS,
  GEMINI_SIDEBAR_HOVER_PROFILE_KEYS,
} from '../../src/core/gemini/selectors/sidebarInteractionKeys';
import { GEMINI_SIDEBAR_PROFILE_KEYS } from '../../src/core/gemini/selectors/sidebarKeys';
import {
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiSelectorProfileKey,
} from '../../src/core/gemini/selectors/types';
import { GEMINI_USAGE_PROFILE_KEYS } from '../../src/core/gemini/selectors/usageKeys';
import {
  MAX_GEMINI_SELECTOR_BYTES,
  readGeminiSelectorProfiles,
  readGeminiSelectorProfileGroup,
} from '../../src/core/gemini/selectors/validation';
import { GEMINI_VIM_PROFILE_KEYS } from '../../src/core/gemini/selectors/vimKeys';

const PROFILE_GROUPS = [
  { file: 'turn.json', keys: GEMINI_TURN_PROFILE_KEYS },
  { file: 'sidebar.json', keys: GEMINI_SIDEBAR_PROFILE_KEYS },
  { file: 'model-picker.json', keys: GEMINI_MODEL_PICKER_PROFILE_KEYS },
  { file: 'composer.json', keys: GEMINI_COMPOSER_PROFILE_KEYS },
  { file: 'input-collapse.json', keys: GEMINI_INPUT_COLLAPSE_PROFILE_KEYS },
  { file: 'vim.json', keys: GEMINI_VIM_PROFILE_KEYS },
  { file: 'prompt-history.json', keys: GEMINI_PROMPT_HISTORY_PROFILE_KEYS },
  { file: 'slash.json', keys: GEMINI_SLASH_PROFILE_KEYS },
  { file: 'sent-chips.json', keys: GEMINI_SENT_CHIPS_PROFILE_KEYS },
  { file: 'project.json', keys: GEMINI_PROJECT_PROFILE_KEYS },
  { file: 'activity.json', keys: GEMINI_ACTIVITY_PROFILE_KEYS },
  { file: 'menu.json', keys: GEMINI_MENU_PROFILE_KEYS },
  { file: 'menu-overlay.json', keys: GEMINI_EXPORT_OVERLAY_PROFILE_KEYS },
  { file: 'sidebar-width.json', keys: GEMINI_SIDEBAR_WIDTH_PROFILE_KEYS },
  { file: 'sidebar-hover.json', keys: GEMINI_SIDEBAR_HOVER_PROFILE_KEYS },
  { file: 'gems.json', keys: GEMINI_GEMS_PROFILE_KEYS },
  { file: 'content.json', keys: GEMINI_CONTENT_PROFILE_KEYS },
  { file: 'context-images.json', keys: GEMINI_CONTEXT_IMAGE_PROFILE_KEYS },
  { file: 'response-actions.json', keys: GEMINI_RESPONSE_ACTION_PROFILE_KEYS },
  { file: 'research-pack.json', keys: GEMINI_RESEARCH_PACK_PROFILE_KEYS },
  { file: 'usage.json', keys: GEMINI_USAGE_PROFILE_KEYS },
  { file: 'code.json', keys: GEMINI_CODE_PROFILE_KEYS },
  { file: 'user-latex.json', keys: GEMINI_USER_LATEX_PROFILE_KEYS },
  { file: 'image-export.json', keys: GEMINI_IMAGE_EXPORT_PROFILE_KEYS },
  { file: 'generated-image.json', keys: GEMINI_GENERATED_IMAGE_PROFILE_KEYS },
  { file: 'canvas-code.json', keys: GEMINI_CANVAS_CODE_PROFILE_KEYS },
] as const;

/** Read only the fragments imported by the page bundle, never packaged safety locators. */
export function readPublishedSiteLocators(catalogDir: string, siteId: string) {
  if (siteId !== 'gemini') return undefined;
  const root = join(catalogDir, 'sites', siteId, 'selector-data');
  if (!existsSync(root)) return undefined;
  const selectors: Partial<Record<GeminiSelectorProfileKey, readonly string[]>> = {};
  for (const group of PROFILE_GROUPS) {
    const path = join(root, group.file);
    const raw = readFileSync(path, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_GEMINI_SELECTOR_BYTES) {
      throw new Error(`${path}: locator source exceeds the decoded byte limit`);
    }
    const profiles = readGeminiSelectorProfileGroup<GeminiSelectorProfileKey>(
      JSON.parse(raw) as unknown,
      group.keys,
    );
    if (!profiles) throw new Error(`${path}: bundled locator group is incomplete or invalid`);
    Object.assign(selectors, profiles);
  }
  const profiles = readGeminiSelectorProfiles(selectors);
  if (!profiles) throw new Error(`${root}: combined locator profiles exceed the shared contract`);
  return profiles;
}
