import { getSiteSelectorView, pageSemanticSelector } from '@/core/selectors';
import packaged from '@/features/plugins/catalog/sites/chatgpt/selector-data/export-packaged.json';
import remote from '@/features/plugins/catalog/sites/chatgpt/selector-data/export-surfaces.json';
import site from '@/features/plugins/catalog/sites/chatgpt/site.json';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

/** Identity and content protocols cannot be repaired independently of their native evidence. */
export const chatgptExportData = {
  ...packaged,
  'export.streaming': remote['export.streaming'],
  'export.loggedOutStreaming': remote['export.loggedOutStreaming'].join(','),
  'export.loggedOutThread': remote['export.loggedOutThread'].join(','),
  'export.loggedOutAssistant': remote['export.loggedOutAssistant'].join(','),
};
// The adapter userTurn also names legacy frames; current-thread reads must keep their inner bubble.
export const CHATGPT_USER_BUBBLE = packaged['export.userBubble'];
export const CHATGPT_ASSISTANT_TURN = site.selectors.assistantTurn;

/** Current-thread bubbles keep their narrower baseline until a complete remote turn repair wins. */
export function chatgptTurnSelector(role: 'userTurn' | 'assistantTurn'): string {
  const baseline = role === 'userTurn' ? CHATGPT_USER_BUBBLE : CHATGPT_ASSISTANT_TURN;
  if (!getSiteSelectorView('chatgpt').remoteKeys.has(role)) return baseline;
  const selector = pageSemanticSelector(chatgptAdapter, role);
  return selector && selector !== site.selectors[role] ? selector : baseline;
}
