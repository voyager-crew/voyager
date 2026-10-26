import profiles from '../../../features/plugins/catalog/sites/chatgpt/selector-data/actions.json';

/** Reply roots need independent completeness and original-response ownership before extraction. */
export const CHATGPT_ACTION_KEYS = [
  'bridge.replyContent',
  'actions.temporaryToggle',
  'actions.newChat',
  'actions.shareButton',
  'actions.homeLink',
  'actions.thinking',
] as const;
export const CHATGPT_ACTION_GROUPS = [
  ['bridge.replyContent'],
  ['actions.temporaryToggle'],
  ['actions.newChat'],
  ['actions.shareButton'],
  ['actions.homeLink'],
  ['actions.thinking'],
] as const;
export const CHATGPT_ACTION_PROFILES = profiles;
export const CHATGPT_ACTION_FILES = ['actions.json'] as const;
