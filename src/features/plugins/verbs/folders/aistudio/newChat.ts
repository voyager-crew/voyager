/**
 * "New chat in this folder" on AI Studio: its nav's own new-chat link opens
 * `/prompts/new_chat`, and the prompt the first run creates is placed into the
 * folder and saved as a prompt dropped on it is.
 */
import type { SiteAdapter } from '@/features/plugins/types';
import { NEW_CHAT_TARGETS } from '@/pages/content/createMode/newChat';
import { extractPromptIdFromHref } from '@/pages/content/folder/aistudioPromptLinks';
import type { AIStudioFolderSession } from '@/pages/content/folder/session/aistudioFolderSession';

import { openFolderPicker } from '../folderPicker';
import type { NewChatPort } from '../newChatFiling';
import type { AIStudioFoldersView } from './view';

const NEW_CHAT_ID = 'new_chat';

async function placeNewPrompt(
  session: AIStudioFolderSession,
  view: () => AIStudioFoldersView | null,
  folderId: string,
  conversationId: string,
): Promise<void> {
  const folder = session.data.folders.find((item) => item.id === folderId);
  if (!folder || !session.canEdit) return;
  const activation = session.activation;
  const t = session.translate;
  await session.commands.run({
    kind: 'placeAIStudioPrompt',
    prompt: { conversationId, title: '', url: `${location.origin}${location.pathname}` },
    target: folderId,
    untitledTitle: t('conversation_untitled'),
    at: Date.now(),
  });
  if (!(await session.save()) || session.activation !== activation) return;
  view()?.render();
  view()?.notify(t('conversation_added_to_folder').split('{folder}').join(folder.name), 'info');
}

/** `null` where AI Studio's site.json names no composer or run button. */
export function aistudioNewChatPort(
  session: AIStudioFolderSession,
  selectors: SiteAdapter['selectors'] | undefined,
  view: () => AIStudioFoldersView | null,
): NewChatPort | null {
  const composer = selectors?.composer;
  const sendButton = selectors?.sendButton;
  if (!composer || !sendButton) return null;
  return {
    newChatLink: () => NEW_CHAT_TARGETS.aistudio.link(document),
    // `/u/<n>/` routes too, which the target's own path leaves out.
    isNewChat: (href) => extractPromptIdFromHref(href) === NEW_CHAT_ID,
    conversationIdOf: (href) => {
      const id = extractPromptIdFromHref(href);
      return id && id !== NEW_CHAT_ID ? id : null;
    },
    composer,
    sendButton,
    composerRoot: selectors?.composerRoot,
    folderName: (folderId) =>
      session.data.folders.find((folder) => folder.id === folderId)?.name ?? null,
    hasFolders: () => session.canEdit && session.data.folders.length > 0,
    // Placing the new prompt needs an editable session; offer no picker without one.
    pickFolder: (onSelect) =>
      session.canEdit
        ? openFolderPicker(
            session.data,
            onSelect,
            session.translate('folderAsProject_selectFolder'),
          )
        : null,
    file: (folderId, conversationId) =>
      void placeNewPrompt(session, view, folderId, conversationId),
    notify: (message, tone) => view()?.notify(message, tone),
  };
}
