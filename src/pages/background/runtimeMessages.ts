import { getVoyagerBuildTarget } from '@/core/utils/browser';
import { isRemoteAnnouncementRuntimeMessage } from '@/features/announcements/background';
import {
  chatGptHandoffTabIdResponse,
  handleChatGptHandoffExpiryMessage,
  isChatGptHandoffExpiryMessage,
} from '@/features/plugins/builtin/chatgptTemporaryHandoff/background';
import { CHATGPT_HANDOFF_GET_TAB_ID_MESSAGE } from '@/features/plugins/builtin/chatgptTemporaryHandoff/storage';

import { createCatalogOutlineMessageHandler } from './catalogOutlineMessages';
import { handleHighlightRuntimeMessage } from './highlightMessages';
import { handlePageRuntimeMessage } from './pageRuntimeMessages';
import { handleRuntimeImageMessage, isRuntimeImageMessage } from './runtimeImageMessages';
import { isHandledBackgroundRuntimeMessage } from './runtimeMessageRouting';
import { createSendTimeMessageHandler } from './sendTimeMessages';

type BackgroundRuntimeMessage = {
  type: string;
  payload?: unknown;
  url?: unknown;
  data?: unknown;
  timeout?: unknown;
};
type MessageHandler = (
  message: BackgroundRuntimeMessage,
  sender: chrome.runtime.MessageSender,
) => Promise<unknown> | null;

// Registration stays synchronous; recognized asynchronous families alone keep the channel open.
export function registerBackgroundRuntimeMessages(owners: {
  handlePluginMessage: MessageHandler;
  handleGeneratedUiMessage: MessageHandler;
  handleNotificationMessage: MessageHandler;
  handleStarredMessage: MessageHandler;
  handleForkMessage(message: BackgroundRuntimeMessage): Promise<unknown> | null;
  handleCloudSyncMessage: MessageHandler;
  announcements: {
    getPendingAnnouncements(): Promise<unknown>;
    acknowledgeAnnouncement(id: string): Promise<void>;
  };
}): void {
  const handleSendTimeMessage = createSendTimeMessageHandler();
  const handleCatalogOutlineMessage = createCatalogOutlineMessageHandler();
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isHandledBackgroundRuntimeMessage(message)) return undefined;

    if (getVoyagerBuildTarget() === 'safari' && isRuntimeImageMessage(message)) {
      void handleRuntimeImageMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }
    (async () => {
      try {
        if (isRuntimeImageMessage(message)) {
          sendResponse(await handleRuntimeImageMessage(message, sender));
          return;
        }

        const pluginResponse = owners.handlePluginMessage(message, sender);
        if (pluginResponse) {
          sendResponse(await pluginResponse);
          return;
        }
        if (isChatGptHandoffExpiryMessage(message)) {
          sendResponse(await handleChatGptHandoffExpiryMessage(message));
          return;
        }
        if (message?.type === CHATGPT_HANDOFF_GET_TAB_ID_MESSAGE) {
          sendResponse(chatGptHandoffTabIdResponse(sender.tab?.id));
          return;
        }

        const captureResponse = owners.handleGeneratedUiMessage(message, sender);
        if (captureResponse) {
          sendResponse(await captureResponse);
          return;
        }
        const sendTimeResponse = handleSendTimeMessage(message, sender);
        if (sendTimeResponse) {
          sendResponse(await sendTimeResponse);
          return;
        }
        const outlineResponse = handleCatalogOutlineMessage(message, sender);
        if (outlineResponse) {
          sendResponse(await outlineResponse);
          return;
        }
        const pageResponse = handlePageRuntimeMessage(message, sender);
        if (pageResponse) {
          sendResponse(await pageResponse);
          return;
        }
        const notificationResponse = owners.handleNotificationMessage(message, sender);
        if (notificationResponse) {
          sendResponse(await notificationResponse);
          return;
        }

        if (isRemoteAnnouncementRuntimeMessage(message)) {
          if (message.type === 'gv.remoteAnnouncement.getPending') {
            sendResponse({
              ok: true,
              announcements: await owners.announcements.getPendingAnnouncements(),
            });
            return;
          }
          const id = typeof message.payload?.id === 'string' ? message.payload.id : '';
          if (id) await owners.announcements.acknowledgeAnnouncement(id);
          sendResponse({ ok: true });
          return;
        }

        const highlightResponse = handleHighlightRuntimeMessage(message, sender);
        if (highlightResponse) {
          sendResponse(await highlightResponse);
          return;
        }
        const starredResponse = owners.handleStarredMessage(message, sender);
        if (starredResponse) {
          sendResponse(await starredResponse);
          return;
        }
        const forkResponse = owners.handleForkMessage(message);
        if (forkResponse) {
          sendResponse(await forkResponse);
          return;
        }
        const syncResponse = owners.handleCloudSyncMessage(message, sender);
        if (syncResponse) {
          sendResponse(await syncResponse);
          return;
        }
      } catch (e) {
        try {
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } catch {}
      }
    })();
    return true;
  });
}
