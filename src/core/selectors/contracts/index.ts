import {
  GEMINI_SELECTOR_PROFILE_GROUPS,
  GEMINI_SELECTOR_PROFILE_KEYS,
} from '../../gemini/selectors/types';
import type { SiteSelectorContract } from '../types';
import {
  AISTUDIO_SURFACE_FILES,
  AISTUDIO_SURFACE_GROUPS,
  AISTUDIO_SURFACE_KEYS,
} from './aistudioSurfaces';
import { CHATGPT_ACTION_GROUPS, CHATGPT_ACTION_KEYS } from './chatgptActions';
import { CHATGPT_EXPORT_KEYS, CHATGPT_EXPORT_GROUPS, CHATGPT_EXPORT_FILES } from './chatgptExport';
import { CHATGPT_SEMANTIC_KEYS, CHATGPT_SEMANTIC_GROUPS } from './chatgptSemantics';
import { COMMON_SEMANTIC_KEYS, commonSemanticGroups } from './commonSemantics';
import { EXPORT_GROUPS, EXPORT_KEYS } from './export';
import { GEMINI_SELECTOR_FILES } from './gemini';
import {
  INPUT_SITE_FILES,
  INPUT_SITE_GROUPS,
  INPUT_SITE_KEYS,
  INPUT_SEMANTIC_KEYS,
  INPUT_SEMANTIC_GROUPS,
} from './inputSurfaces';
import { PLACEMENT_KEYS, PLACEMENT_GROUPS, PLACEMENT_FILES } from './placement';
import { TIMELINE_TEXT_KEYS, TIMELINE_TEXT_GROUPS, TIMELINE_TEXT_FILES } from './timeline';

const EXPORT_FILE = { file: 'export.json', keys: EXPORT_KEYS };

export const SITE_SELECTOR_CONTRACTS: Readonly<Record<string, SiteSelectorContract>> = {
  gemini: {
    keys: GEMINI_SELECTOR_PROFILE_KEYS,
    groups: GEMINI_SELECTOR_PROFILE_GROUPS,
    files: GEMINI_SELECTOR_FILES,
  },
  aistudio: {
    keys: [
      ...INPUT_SITE_KEYS.aistudio,
      ...INPUT_SEMANTIC_KEYS.aistudio,
      ...AISTUDIO_SURFACE_KEYS,
      ...PLACEMENT_KEYS,
      ...TIMELINE_TEXT_KEYS,
    ],
    groups: [
      ...INPUT_SITE_GROUPS.aistudio,
      ...INPUT_SEMANTIC_GROUPS.aistudio,
      ...AISTUDIO_SURFACE_GROUPS,
      ...PLACEMENT_GROUPS,
      ...TIMELINE_TEXT_GROUPS,
    ],
    files: [
      ...INPUT_SITE_FILES.aistudio,
      ...AISTUDIO_SURFACE_FILES,
      ...PLACEMENT_FILES,
      ...TIMELINE_TEXT_FILES,
    ],
  },
  chatgpt: {
    keys: [
      ...INPUT_SITE_KEYS.chatgpt,
      ...INPUT_SEMANTIC_KEYS.chatgpt,
      ...CHATGPT_ACTION_KEYS,
      ...CHATGPT_SEMANTIC_KEYS,
      ...COMMON_SEMANTIC_KEYS.chatgpt,
      ...CHATGPT_EXPORT_KEYS,
      ...EXPORT_KEYS,
      ...PLACEMENT_KEYS,
      ...TIMELINE_TEXT_KEYS,
    ],
    groups: [
      ...INPUT_SITE_GROUPS.chatgpt,
      ...INPUT_SEMANTIC_GROUPS.chatgpt,
      ...CHATGPT_ACTION_GROUPS,
      ...CHATGPT_SEMANTIC_GROUPS,
      ...commonSemanticGroups('chatgpt'),
      ...CHATGPT_EXPORT_GROUPS,
      ...EXPORT_GROUPS,
      ...PLACEMENT_GROUPS,
      ...TIMELINE_TEXT_GROUPS,
    ],
    files: [
      ...INPUT_SITE_FILES.chatgpt,
      { file: 'actions.json', keys: CHATGPT_ACTION_KEYS },
      ...CHATGPT_EXPORT_FILES,
      EXPORT_FILE,
      ...PLACEMENT_FILES,
      ...TIMELINE_TEXT_FILES,
    ],
  },
  claude: {
    keys: [
      ...COMMON_SEMANTIC_KEYS.claude,
      ...INPUT_SITE_KEYS.claude,
      ...INPUT_SEMANTIC_KEYS.claude,
      ...EXPORT_KEYS,
      ...PLACEMENT_KEYS,
      ...TIMELINE_TEXT_KEYS,
    ],
    groups: [
      ...commonSemanticGroups('claude'),
      ...INPUT_SITE_GROUPS.claude,
      ...INPUT_SEMANTIC_GROUPS.claude,
      ...EXPORT_GROUPS,
      ...PLACEMENT_GROUPS,
      ...TIMELINE_TEXT_GROUPS,
    ],
    files: [...INPUT_SITE_FILES.claude, EXPORT_FILE, ...PLACEMENT_FILES, ...TIMELINE_TEXT_FILES],
  },
  deepseek: {
    keys: [
      ...COMMON_SEMANTIC_KEYS.deepseek,
      ...INPUT_SITE_KEYS.deepseek,
      ...INPUT_SEMANTIC_KEYS.deepseek,
      ...EXPORT_KEYS,
      ...PLACEMENT_KEYS,
      ...TIMELINE_TEXT_KEYS,
    ],
    groups: [
      ...commonSemanticGroups('deepseek'),
      ...INPUT_SITE_GROUPS.deepseek,
      ...INPUT_SEMANTIC_GROUPS.deepseek,
      ...EXPORT_GROUPS,
      ...PLACEMENT_GROUPS,
      ...TIMELINE_TEXT_GROUPS,
    ],
    files: [...INPUT_SITE_FILES.deepseek, EXPORT_FILE, ...PLACEMENT_FILES, ...TIMELINE_TEXT_FILES],
  },
  kimi: {
    keys: [
      ...COMMON_SEMANTIC_KEYS.kimi,
      ...INPUT_SITE_KEYS.kimi,
      ...INPUT_SEMANTIC_KEYS.kimi,
      ...EXPORT_KEYS,
      ...PLACEMENT_KEYS,
      ...TIMELINE_TEXT_KEYS,
    ],
    groups: [
      ...commonSemanticGroups('kimi'),
      ...INPUT_SITE_GROUPS.kimi,
      ...INPUT_SEMANTIC_GROUPS.kimi,
      ...EXPORT_GROUPS,
      ...PLACEMENT_GROUPS,
      ...TIMELINE_TEXT_GROUPS,
    ],
    files: [...INPUT_SITE_FILES.kimi, EXPORT_FILE, ...PLACEMENT_FILES, ...TIMELINE_TEXT_FILES],
  },
};

export function getSiteSelectorContract(siteId: string): SiteSelectorContract | undefined {
  return Object.hasOwn(SITE_SELECTOR_CONTRACTS, siteId)
    ? SITE_SELECTOR_CONTRACTS[siteId]
    : undefined;
}
