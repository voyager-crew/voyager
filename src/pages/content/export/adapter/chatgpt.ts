import type { ChatTurn } from '@/features/export/types/export';
import { chatGptTurnHash, loadChatGptStarHashes } from '@/features/savedLibrary/exportStars';

import { chatgptExportData } from './chatgptExportData';
import {
  captureScrollState,
  restoreScrollState,
  resolveSelectedContainers,
  extractSiblingGeneratedImages,
  chatgptCollectTurnContainers,
  materializeChatGptTurnContainer,
} from './chatgptLegacyDom';
import { assertActive, mergeExtractedContent } from './chatgptShared';
import { USER_BUBBLE_SELECTOR } from './chatgptThread';
import type { ChatGptReadOptions, ChatGptTurnContainer } from './type';

export {
  chatgptCollectTurnContainers,
  isChatGptResponseGenerating,
  materializeChatGptTurnContainer,
  resolveChatGptSelectionRoles,
} from './chatgptLegacyDom';
const USER_MESSAGE_SELECTOR = chatgptExportData['export.legacyUser'];
const ASSISTANT_MESSAGE_SELECTOR = chatgptExportData['export.legacyAssistant'];

function promptBubble(container: Element): Element | null {
  const user = container.querySelector(USER_MESSAGE_SELECTOR);
  // The timeline prefers the inner bubble; surrounding action text is not its identity.
  return user?.querySelector(USER_BUBBLE_SELECTOR) ?? user;
}

function promptHash(container: Element): string | undefined {
  const bubble = promptBubble(container);
  return bubble ? chatGptTurnHash(bubble) : undefined;
}

interface RetainedThreadVersion {
  readonly ids: string;
  readonly promptIds: ReadonlySet<string>;
  readonly prompts: Map<string, string>;
}

function retainedThreadVersion(
  registry: readonly ChatGptTurnContainer[],
  promptIds: ReadonlySet<string>,
): RetainedThreadVersion {
  const prompts = new Map<string, string>();
  for (const turn of registry) {
    if (!promptIds.has(turn.id)) continue;
    const bubble = promptBubble(turn.container);
    // Empty prompt roots are mounting placeholders, not a changed exchange.
    if (bubble?.textContent?.trim()) prompts.set(turn.id, chatGptTurnHash(bubble));
  }
  return { ids: JSON.stringify(registry.map((turn) => turn.id)), promptIds, prompts };
}

function assertRetainedThreadVersion(version: RetainedThreadVersion): void {
  const current = retainedThreadVersion(chatgptCollectTurnContainers(), version.promptIds);
  // Replies may finish streaming; only ids and prompts determine exchange star identity.
  if (
    current.ids !== version.ids ||
    Array.from(version.prompts).some(
      ([id, hash]) => current.prompts.has(id) && current.prompts.get(id) !== hash,
    )
  ) {
    throw new Error('chatgpt_export_thread_changed');
  }
  for (const [id, hash] of current.prompts) {
    if (!version.prompts.has(id)) version.prompts.set(id, hash);
  }
}

/**
 * Builds export-ready ChatTurn records for selected ChatGPT message containers.
 *
 * ChatGPT keeps every `[data-turn-id-container]` element as an ordered virtual
 * list item, but unloads its inner message DOM outside the viewport. The
 * selected container IDs are therefore the stable selection and ordering source.
 * For each selected ID we:
 *
 * 1. look it up in a fresh container registry, preserving the conversation order;
 * 2. scroll it into view and wait for ChatGPT to mount and settle its content;
 * 3. immediately extract the message to persist rich text/HTML before the
 *    next scroll can cause ChatGPT to unload this message again;
 * 4. merge adjacent selected user and assistant messages into the existing
 *    platform-neutral ChatTurn shape consumed by all export formats.
 *
 * A selected assistant without its user message deliberately becomes an
 * assistant-only ChatTurn. This preserves the user's message-level selection
 * rather than silently attaching it to an unselected prompt.
 */
export async function buildChatGptTurnsForSelection(
  selectedContainerIds: ReadonlySet<string>,
  options: ChatGptReadOptions,
): Promise<ChatTurn[]> {
  const { extractor } = options;
  const captured = { ...options, expectedUrl: options.expectedUrl ?? location.href };
  // querySelectorAll returns ChatGPT's retained virtual-list order. Filtering
  // this registry, rather than sorting visual coordinates, prevents image cards
  // and independently positioned DOM wrappers from changing export order.
  assertActive(captured);
  const registry = chatgptCollectTurnContainers();
  const selectedContainers = resolveSelectedContainers(selectedContainerIds, registry);
  const promptIds = new Set(
    selectedContainers
      .flatMap((turn) =>
        turn.role === 'user' ? [turn.id] : [turn.id, registry[turn.sequence - 1]?.id],
      )
      .filter((id): id is string => id !== undefined),
  );
  const version = retainedThreadVersion(registry, promptIds);
  const scrollState = captureScrollState(selectedContainers[0]?.container);

  const turns: ChatTurn[] = [];
  let pendingUser: { readonly turn: ChatTurn; readonly sequence: number } | null = null;
  const handledIds = new Set<string>();

  try {
    const hashes = await loadChatGptStarHashes(captured.expectedUrl);
    // A branch can change during prompt/return scrolling too, not just the Library read.
    const assertThread = () => {
      assertActive(captured);
      if (hashes.size > 0) assertRetainedThreadVersion(version);
    };
    assertThread();
    const promptHashes = new Map<string, string | undefined>();
    for (const turn of selectedContainers) {
      let materialized = await materializeChatGptTurnContainer(turn, captured);
      assertThread();
      if (materialized.empty) {
        // Nothing to export for this turn, but not a failure: ChatGPT itself
        // shows it blank. Pairing stays sequence-based, so a prompt followed by
        // a blank response exports as a user-only turn.
        promptHashes.set(turn.id, undefined);
        handledIds.add(turn.id);
        continue;
      }
      let starHash: string | undefined;
      if (hashes.size > 0) {
        if (materialized.role === 'user') {
          starHash = promptHash(materialized.container);
          promptHashes.set(turn.id, starHash);
        } else if (materialized.role === 'assistant') {
          const prompt = registry[turn.sequence - 1];
          if (prompt && prompt.role !== 'assistant') {
            if (!promptHashes.has(prompt.id)) {
              // Only assistant-only selections need an extra prompt materialization.
              const mounted = await materializeChatGptTurnContainer(prompt, captured);
              assertThread();
              promptHashes.set(
                prompt.id,
                mounted.role === 'user' && !mounted.empty
                  ? promptHash(mounted.container)
                  : undefined,
              );
              // Reading the unselected prompt may have unloaded the selected reply.
              materialized = await materializeChatGptTurnContainer(turn, captured);
              assertThread();
              if (materialized.empty) {
                handledIds.add(turn.id);
                continue;
              }
            }
            starHash = promptHashes.get(prompt.id);
          }
        }
      }
      const { container, role } = materialized;
      const sequence = turn.sequence;
      const starred = starHash !== undefined && hashes.has(starHash);

      if (role === 'user') {
        // A second user message closes an earlier selected user-only turn.
        if (pendingUser) turns.push(pendingUser.turn);

        const userElement = container.querySelector<HTMLElement>(USER_MESSAGE_SELECTOR);
        if (!userElement) throw new Error(`chatgpt_export_message_unavailable:${turn.id}`);

        const userContent = extractor.extractUserContent(userElement);
        if (!userContent.text && !userContent.html && userContent.attachments.length === 0) {
          throw new Error(`chatgpt_export_message_empty:${turn.id}`);
        }
        pendingUser = {
          sequence,
          turn: {
            user: userContent.text,
            assistant: '',
            starred,
            attachments: userContent.attachments,
            omitEmptySections: true,
            userContent,
          },
        };
        handledIds.add(turn.id);
        continue;
      }

      if (role === 'assistant') {
        const assistantElement =
          container.querySelector<HTMLElement>(ASSISTANT_MESSAGE_SELECTOR) ?? container;
        let assistantContent = extractor.extractAssistantContent(assistantElement);
        const siblingImageContent = extractSiblingGeneratedImages(
          container,
          assistantElement,
          extractor,
        );
        if (siblingImageContent) {
          assistantContent = mergeExtractedContent(assistantContent, siblingImageContent);
        }
        if (!assistantContent.text && !assistantContent.html) {
          throw new Error(`chatgpt_export_message_empty:${turn.id}`);
        }

        if (pendingUser?.sequence === sequence - 1) {
          pendingUser.turn.assistant = assistantContent.text;
          pendingUser.turn.assistantContent = assistantContent;
          turns.push(pendingUser.turn);
          pendingUser = null;
        } else {
          if (pendingUser) {
            turns.push(pendingUser.turn);
            pendingUser = null;
          }
          turns.push({
            user: '',
            assistant: assistantContent.text,
            starred,
            omitEmptySections: true,
            assistantContent,
          });
        }
        handledIds.add(turn.id);
        continue;
      }

      throw new Error(`chatgpt_export_role_unavailable:${turn.id}`);
    }

    if (pendingUser) turns.push(pendingUser.turn);
    if (handledIds.size !== selectedContainerIds.size) {
      throw new Error('chatgpt_export_incomplete_selection');
    }

    return turns;
  } finally {
    restoreScrollState(scrollState);
  }
}
