import packaged from '@/features/plugins/catalog/sites/chatgpt/selector-data/export-packaged.json';
import site from '@/features/plugins/catalog/sites/chatgpt/site.json';

/** Identity and content protocols cannot be repaired independently of their native evidence. */
export const chatgptExportData = packaged;
// The adapter userTurn also names legacy frames; current-thread reads must keep their inner bubble.
export const CHATGPT_USER_BUBBLE = packaged['export.userBubble'];
export const CHATGPT_ASSISTANT_TURN = site.selectors.assistantTurn;
export const CHATGPT_CODE_BLOCK = site.selectors.codeBlock;
