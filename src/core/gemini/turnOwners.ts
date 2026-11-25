/**
 * Packaged native owners of one Gemini exchange and its turns, for both frontends Google serves:
 * the Angular app (`.conversation-container`, `user-query`, `model-response`) and the React rewrite
 * rolled out to some accounts (#1113), where each exchange is an `article` in the chat scrollport.
 * Proofs read these, never downloaded locators, so a remote fix for either UI meets the same bar.
 */
export const GEMINI_EXCHANGE_OWNER = '.conversation-container, [data-chat-scrollport] article';

/** Turn hosts: a candidate crossing one of these belongs to another turn. */
export const GEMINI_TURN_HOSTS =
  'model-response, user-query, section[data-test-id="model-response"], section[data-test-id="user-query"]';
