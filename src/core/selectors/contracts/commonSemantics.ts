import chatgpt from '../../../features/plugins/catalog/sites/chatgpt/site.json';
import claude from '../../../features/plugins/catalog/sites/claude/site.json';
import deepseek from '../../../features/plugins/catalog/sites/deepseek/site.json';
import kimi from '../../../features/plugins/catalog/sites/kimi/site.json';

/** Only these shared semantic surfaces have independent structural repair evidence. */
export const COMMON_SEMANTIC_KEYS = {
  chatgpt: ['codeBlock', 'sidebar', 'scrollContainer'],
  claude: ['sidebar', 'scrollContainer'],
  deepseek: ['codeBlock', 'sidebar', 'scrollContainer'],
  kimi: ['sidebar', 'scrollContainer'],
} as const;

export function commonSemanticGroups(siteId: keyof typeof COMMON_SEMANTIC_KEYS) {
  return COMMON_SEMANTIC_KEYS[siteId].map((key) => [key]);
}

/** Native conversation route protocols have one packaged source. */
export const COMMON_CONVERSATION_PATTERNS: Readonly<Record<string, string>> = {
  chatgpt: chatgpt.conversationIdPattern,
  claude: claude.conversationIdPattern,
  deepseek: deepseek.conversationIdPattern,
  kimi: kimi.conversationIdPattern,
};
