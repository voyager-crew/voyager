import { resolveGeminiTurnOperation } from '@/core/gemini/selectors';

import { geminiAssistantTurnSelectors, geminiUserTurnSelectors } from './conversationDom';

function readGeminiTurnReadiness() {
  return resolveGeminiTurnOperation(
    (view) => {
      const users = geminiUserTurnSelectors(view);
      let firstUser: Element | null = null;
      for (const selector of users) {
        firstUser = document.querySelector(selector);
        if (firstUser) break;
      }
      return { users, assistants: geminiAssistantTurnSelectors(view), firstUser };
    },
    ({ firstUser }) => firstUser !== null,
  ).value;
}

/** Re-evaluate inside the existing wait, so late remote-only DOM is still discoverable. */
export function geminiReadyUserSelectors(): string[] {
  return readGeminiTurnReadiness().users;
}

/** One accepted view supplies both sides of a history-preload fingerprint. */
export function geminiFingerprintSelectors(): string[] {
  const { users, assistants } = readGeminiTurnReadiness();
  return [...users, ...assistants];
}
