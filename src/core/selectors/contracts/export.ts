import chatgpt from '../../../features/plugins/catalog/sites/chatgpt/selector-data/export.json';
import claude from '../../../features/plugins/catalog/sites/claude/selector-data/export.json';
import deepseek from '../../../features/plugins/catalog/sites/deepseek/selector-data/export.json';
import kimi from '../../../features/plugins/catalog/sites/kimi/selector-data/export.json';

/** A complete response body may be repaired inside the message the operation already owns. */
export const EXPORT_KEYS = ['export.assistantContent'] as const;
export const EXPORT_GROUPS = [EXPORT_KEYS] as const;
export const EXPORT_PROFILES = { chatgpt, claude, deepseek, kimi };
