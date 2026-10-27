import { createConversationCollector } from '../../conversationCollector';
import type { ExportPlatformAdapter } from '../platformAdapters';

export function mountUnknownExportFixture(): void {
  document.title = 'Legacy custom conversation';
  document.body.innerHTML = `<main><section id="chat-history">
    <div class="conversation-container"><user-query class="user-query-container" data-turn-id="first"><p class="query-text-line">Question one</p><user-query-file-preview><span data-test-id="uploaded-file" aria-label="notes.pdf">notes.pdf</span></user-query-file-preview></user-query><model-response class="response-container"><model-thoughts><message-content>Private reasoning</message-content></model-thoughts><message-content><div class="markdown"><p>Answer <b>one</b></p><code-block><pre><code>const x = 1;</code></pre></code-block><span data-math="x^2">x²</span><single-image><img src="https://example.com/one.png" alt="one"></single-image><p>Tail</p></div></message-content></model-response></div>
    <div class="conversation-container"><article data-author="user" data-turn-id="second"><p class="query-text-line">Question two</p></article><article data-author="assistant"><message-content><p>Answer two</p></message-content></article></div>
    <div class="conversation-container"><article data-turn="user" data-turn-id="third"><p class="query-text-line">Pending prompt</p></article></div>
  </section></main>`;
}

export function unknownExportSnapshot(adapter: ExportPlatformAdapter) {
  const collector = createConversationCollector(adapter);
  const messages = collector.collectSelectionMessages();
  const turns = collector.turnsForMessageIds(new Set(messages.map((message) => message.messageId)));
  return {
    platform: adapter.site.label,
    title: adapter.extractConversationTitle(),
    conversationId: adapter.extractConversationIdFromUrl(),
    root: collector.conversationRoot().id,
    ids: messages.map((message) => message.messageId),
    roles: messages.map((message) => message.role),
    pairs: collector
      .collectChatPairs()
      .map(({ user, assistant, turnId }) => ({ user, assistant, turnId })),
    turns: turns.map(
      ({ user, assistant, userContent, assistantContent, omitEmptySections, starred }) => ({
        user,
        assistant,
        userContent,
        assistantContent,
        omitEmptySections,
        starred,
      }),
    ),
  };
}
