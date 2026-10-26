import aistudio from '../../../features/plugins/catalog/sites/aistudio/selector-data/timeline.json';
import chatgpt from '../../../features/plugins/catalog/sites/chatgpt/selector-data/timeline.json';
import claude from '../../../features/plugins/catalog/sites/claude/selector-data/timeline.json';
import deepseek from '../../../features/plugins/catalog/sites/deepseek/selector-data/timeline.json';
import gemini from '../../../features/plugins/catalog/sites/gemini/selector-data/timeline.json';
import kimi from '../../../features/plugins/catalog/sites/kimi/selector-data/timeline.json';

export const TIMELINE_TEXT_KEYS = ['timeline.userText'] as const;
export const TIMELINE_TEXT_GROUPS = [TIMELINE_TEXT_KEYS];
export const TIMELINE_TEXT_FILES = [{ file: 'timeline.json', keys: TIMELINE_TEXT_KEYS }];
export const TIMELINE_TEXT_PROFILES = { gemini, aistudio, chatgpt, claude, deepseek, kimi };
