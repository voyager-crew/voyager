import { GEMINI_ACTIVITY_PROFILE_KEYS } from '../../gemini/selectors/activityKeys';
import { GEMINI_CANVAS_CODE_PROFILE_KEYS } from '../../gemini/selectors/canvasKeys';
import { GEMINI_CODE_PROFILE_KEYS } from '../../gemini/selectors/codeKeys';
import { GEMINI_COMPOSER_PROFILE_KEYS } from '../../gemini/selectors/composerKeys';
import {
  GEMINI_CONTENT_PROFILE_KEYS,
  GEMINI_CONTEXT_IMAGE_PROFILE_KEYS,
  GEMINI_CONTEXT_TEXT_PROFILE_KEYS,
} from '../../gemini/selectors/contentKeys';
import { GEMINI_EXTENDED_KEYS } from '../../gemini/selectors/extendedKeys';
import { GEMINI_GEMS_PROFILE_KEYS } from '../../gemini/selectors/gemsKeys';
import { GEMINI_GENERATED_IMAGE_PROFILE_KEYS } from '../../gemini/selectors/generatedImageKeys';
import { GEMINI_IMAGE_EXPORT_PROFILE_KEYS } from '../../gemini/selectors/imageExportKeys';
import { GEMINI_INPUT_COLLAPSE_PROFILE_KEYS } from '../../gemini/selectors/inputCollapseKeys';
import { GEMINI_USER_LATEX_PROFILE_KEYS } from '../../gemini/selectors/mathKeys';
import {
  GEMINI_MENU_PROFILE_KEYS,
  GEMINI_EXPORT_OVERLAY_PROFILE_KEYS,
} from '../../gemini/selectors/menuKeys';
import { GEMINI_MODEL_PICKER_PROFILE_KEYS } from '../../gemini/selectors/modelPickerKeys';
import { GEMINI_PROJECT_PROFILE_KEYS } from '../../gemini/selectors/projectKeys';
import {
  GEMINI_PROMPT_HISTORY_PROFILE_KEYS,
  GEMINI_SLASH_PROFILE_KEYS,
  GEMINI_SENT_CHIPS_PROFILE_KEYS,
} from '../../gemini/selectors/promptKeys';
import {
  GEMINI_RESPONSE_ACTION_PROFILE_KEYS,
  GEMINI_RESEARCH_PACK_PROFILE_KEYS,
} from '../../gemini/selectors/responseSurfaceKeys';
import {
  GEMINI_SIDEBAR_WIDTH_PROFILE_KEYS,
  GEMINI_SIDEBAR_HOVER_PROFILE_KEYS,
} from '../../gemini/selectors/sidebarInteractionKeys';
import { GEMINI_SIDEBAR_PROFILE_KEYS } from '../../gemini/selectors/sidebarKeys';
import { GEMINI_TURN_PROFILE_KEYS } from '../../gemini/selectors/types';
import { GEMINI_USAGE_PROFILE_KEYS } from '../../gemini/selectors/usageKeys';
import { GEMINI_VIM_PROFILE_KEYS } from '../../gemini/selectors/vimKeys';
import { PLACEMENT_FILES } from './placement';
import { TIMELINE_TEXT_FILES } from './timeline';

export const GEMINI_SELECTOR_FILES = [
  { file: 'extended.json', keys: GEMINI_EXTENDED_KEYS },
  ...PLACEMENT_FILES,
  ...TIMELINE_TEXT_FILES,
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
  { file: 'context-text.json', keys: GEMINI_CONTEXT_TEXT_PROFILE_KEYS },
  { file: 'response-actions.json', keys: GEMINI_RESPONSE_ACTION_PROFILE_KEYS },
  { file: 'research-pack.json', keys: GEMINI_RESEARCH_PACK_PROFILE_KEYS },
  { file: 'usage.json', keys: GEMINI_USAGE_PROFILE_KEYS },
  { file: 'code.json', keys: GEMINI_CODE_PROFILE_KEYS },
  { file: 'user-latex.json', keys: GEMINI_USER_LATEX_PROFILE_KEYS },
  { file: 'image-export.json', keys: GEMINI_IMAGE_EXPORT_PROFILE_KEYS },
  { file: 'generated-image.json', keys: GEMINI_GENERATED_IMAGE_PROFILE_KEYS },
  { file: 'canvas-code.json', keys: GEMINI_CANVAS_CODE_PROFILE_KEYS },
] as const;
