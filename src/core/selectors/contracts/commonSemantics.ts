/** Shared sidebar placement and independently proved code/scroll surfaces. */
export const COMMON_SEMANTIC_KEYS = {
  chatgpt: ['codeBlock', 'sidebar', 'scrollContainer'],
  claude: ['sidebar', 'scrollContainer'],
  deepseek: ['codeBlock', 'sidebar', 'scrollContainer'],
  kimi: ['sidebar', 'scrollContainer'],
} as const;

export function commonSemanticGroups(siteId: keyof typeof COMMON_SEMANTIC_KEYS) {
  return COMMON_SEMANTIC_KEYS[siteId].map((key) => [key]);
}
