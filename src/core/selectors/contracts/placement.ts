import aistudio from '../../../features/plugins/catalog/sites/aistudio/selector-data/placement.json';
import chatgpt from '../../../features/plugins/catalog/sites/chatgpt/selector-data/placement.json';
import claude from '../../../features/plugins/catalog/sites/claude/selector-data/placement.json';
import deepseek from '../../../features/plugins/catalog/sites/deepseek/selector-data/placement.json';
import gemini from '../../../features/plugins/catalog/sites/gemini/selector-data/placement.json';
import kimi from '../../../features/plugins/catalog/sites/kimi/selector-data/placement.json';

/** Literal Tier B vocabulary; queries only place Voyager UI or measure avoidance. */
export const PLACEMENT_KEYS = [
  'exportLayout.controls',
  'exportLayout.broadControls',
  'exportLayout.canvasOwner',
  'exportLayout.canvasContent',
  'exportLayout.fullscreenCanvas',
  'exportLayout.inactiveCanvas',
  'exportLayout.turns',
  'exportLayout.interactive',
  'exportLayout.overlaySidebar',
  'exportLayout.fallbackRoot',
  'exportLayout.alignmentCanvas',
  'exportLayout.alignmentComposer',
  'input.clearance',
  'input.fab',
  'vim.host',
  'vim.inputFallback',
  'vim.mountInput',
  'vim.mountRoot',
  'vim.mountChatInput',
  'vim.mountChatRoot',
] as const;
export const PLACEMENT_GROUPS = PLACEMENT_KEYS.map((key) => [key]);
export const PLACEMENT_FILES = [{ file: 'placement.json', keys: PLACEMENT_KEYS }];
export const PLACEMENT_PROFILES = { gemini, aistudio, chatgpt, claude, deepseek, kimi };
