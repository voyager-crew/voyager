import aistudio from '../../../features/plugins/catalog/sites/aistudio/selector-data/input.json';
import chatgpt from '../../../features/plugins/catalog/sites/chatgpt/selector-data/input.json';
import claude from '../../../features/plugins/catalog/sites/claude/selector-data/input.json';
import deepseek from '../../../features/plugins/catalog/sites/deepseek/selector-data/input.json';
import kimi from '../../../features/plugins/catalog/sites/kimi/selector-data/input.json';

export const INPUT_SITE_PROFILES = { aistudio, chatgpt, claude, deepseek, kimi };
export const INPUT_SITE_KEYS = {
  aistudio: ['input.candidates', 'input.sendContainers'],
  chatgpt: ['input.candidates', 'vim.candidates', 'input.handoff'],
  claude: ['input.candidates', 'vim.candidates', 'input.handoff'],
  deepseek: [],
  kimi: ['input.candidates', 'vim.candidates'],
} as const;
export const INPUT_SITE_GROUPS = {
  aistudio: [['input.candidates'], ['input.sendContainers']],
  chatgpt: [['input.candidates'], ['vim.candidates'], ['input.handoff']],
  claude: [['input.candidates'], ['vim.candidates'], ['input.handoff']],
  deepseek: [],
  kimi: [['input.candidates'], ['vim.candidates']],
} as const;
export const INPUT_SITE_FILES = {
  aistudio: [{ file: 'input.json', keys: INPUT_SITE_KEYS.aistudio }],
  chatgpt: [{ file: 'input.json', keys: INPUT_SITE_KEYS.chatgpt }],
  claude: [{ file: 'input.json', keys: INPUT_SITE_KEYS.claude }],
  deepseek: [],
  kimi: [{ file: 'input.json', keys: INPUT_SITE_KEYS.kimi }],
} as const;

/** Semantic values have exactly one source, site.json's selectors; they are not copied into fragments. */
export const INPUT_SEMANTIC_KEYS = {
  aistudio: [],
  chatgpt: ['composer', 'composerRoot', 'sendButton'],
  claude: ['composer', 'sendButton'],
  deepseek: [],
  kimi: ['composer'],
} as const;
export const INPUT_SEMANTIC_GROUPS = {
  aistudio: [],
  chatgpt: [['composer', 'composerRoot', 'sendButton']],
  claude: [['composer', 'sendButton']],
  deepseek: [],
  kimi: [['composer']],
} as const;
