import profiles from '../../../features/plugins/catalog/sites/chatgpt/selector-data/export-surfaces.json';

export const CHATGPT_EXPORT_KEYS = [
  'export.streaming',
  'export.loggedOutStreaming',
  'export.loggedOutThread',
  'export.loggedOutAssistant',
  'export.threadList',
  'export.historyPending',
  'export.codeLanguage',
] as const;
export const CHATGPT_EXPORT_GROUPS = [
  ['export.streaming'],
  ['export.loggedOutStreaming'],
  ['export.loggedOutThread', 'export.loggedOutAssistant'],
  ['export.threadList'],
  ['export.historyPending'],
  ['export.codeLanguage'],
] as const;
export const CHATGPT_EXPORT_PROFILES = profiles;
export const CHATGPT_EXPORT_FILES = [
  { file: 'export-surfaces.json', keys: CHATGPT_EXPORT_KEYS },
] as const;
