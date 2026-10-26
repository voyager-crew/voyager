import site from '../../../features/plugins/catalog/sites/chatgpt/site.json';

/** The values remain in site.json; this list alone admits remotely repairable page fields. */
export const CHATGPT_SEMANTIC_KEYS = [
  'userTurn',
  'assistantTurn',
  'headerActions',
  'modelPicker.trigger',
  'modelPicker.effort',
] as const;
export const CHATGPT_SEMANTIC_GROUPS = [
  ['userTurn', 'assistantTurn'],
  ['headerActions'],
  ['modelPicker.trigger'],
  ['modelPicker.effort'],
] as const;
export const CHATGPT_PICKER_PROFILES = {
  'modelPicker.trigger': [site.pageHooks.modelPickerTrigger],
  'modelPicker.effort': [site.pageHooks.effortControl],
};
export const CHATGPT_PAGE_HOOK_KEYS = {
  'modelPicker.trigger': 'modelPickerTrigger',
  'modelPicker.effort': 'effortControl',
} as const;
