/* Background service worker: register listeners synchronously, then let each owner handle its work. */
import { getVoyagerBuildTarget } from '@/core/utils/browser';
import { startRemoteAnnouncementBackgroundService } from '@/features/announcements/background';
import { registerWelcomePageOnInstall } from '@/features/onboarding/welcomePage';
import { startChatGptTemporaryHandoffBackgroundService } from '@/features/plugins/builtin/chatgptTemporaryHandoff/background';
import { HostCatalogRefresher } from '@/features/plugins/remote/hostCatalogRefresh';
import { createStarStore } from '@/features/savedLibrary/starStore';
import { startStorageQuotaWarningBackgroundService } from '@/features/storageQuotaWarning/background';

import {
  disableRetiredTabTitleUpdateSetting,
  migrateOptionalHighlightSetting,
} from './backgroundSettings';
import { startBridgeOwner } from './bridge/bridgeOwnerStart';
import { createCloudSyncMessageHandler } from './cloudSyncMessages';
import { startDevAutoReload } from './devAutoReload';
import { guardDriveWithoutSignIn } from './driveDeviceGuard';
import { createForkMessagesOwner } from './forkMessages';
import { createGeneratedUiCapture } from './generatedUiCapture';
import { createMainWorldRegistration } from './mainWorldRegistration';
import { createNotificationEnablement } from './notificationEnablement';
import { handlePluginRuntimeMessage } from './pluginRuntimeMessages';
import { startQueueOwners } from './queueOwners';
import { registerBackgroundSettingListeners } from './registrationSettings';
import { startResearchPackOwner } from './researchPackOwner';
import { createResponseNotifications } from './responseNotifications';
import { registerBackgroundRuntimeMessages } from './runtimeMessages';
import { createSiteAccessRegistration } from './siteAccessRegistration';
import { createStarredMessagesHandler } from './starredMessages';
import { registerWatermarkDefaultMigrationOnInstall } from './watermarkDefaultMigration';

const responseNotifications = createResponseNotifications();
const notificationEnablement =
  getVoyagerBuildTarget() === 'safari' ? null : createNotificationEnablement();
// Permission prompts can close the popup; the background owns its accepted enable intent.
notificationEnablement?.registerListeners();
void notificationEnablement?.reconcile().catch(() => {
  // A later permission/storage event retries a transient startup read failure.
});
const remoteAnnouncementService = startRemoteAnnouncementBackgroundService();
registerWelcomePageOnInstall();
registerWatermarkDefaultMigrationOnInstall();
if (import.meta.env.VOYAGER_DEV_AUTO_RELOAD) startDevAutoReload();
// Remote plugin catalog: the only network writer. Content scripts and the popup
// only ever ask; this decides (interval, switch, backoff, single flight).
const hostCatalogRefresher = new HostCatalogRefresher();
startChatGptTemporaryHandoffBackgroundService();
startStorageQuotaWarningBackgroundService();
startResearchPackOwner();
startQueueOwners();
// Local Bridge to `voyager serve`: inert until the builtin is on and a pairing exists.
const handleBridgeMessage = startBridgeOwner({
  refreshCatalog: (host) => hostCatalogRefresher.refresh(host),
  refreshCatalogNow: (host) => hostCatalogRefresher.refresh(host, { force: true }),
});

if (getVoyagerBuildTarget() === 'safari') {
  responseNotifications.connectNativeOpenConversationPort();
}
responseNotifications.registerClickListener();

const siteAccess = createSiteAccessRegistration();
const mainWorld = createMainWorldRegistration();
const generatedUiCapture = createGeneratedUiCapture(siteAccess);

// Initial sync for persisted permissions
void disableRetiredTabTitleUpdateSetting();
void migrateOptionalHighlightSetting();
void generatedUiCapture.cleanupLegacyGeneratedUiCapturePermission();
void siteAccess.syncCustom();
void siteAccess.syncPlugins();
void siteAccess.refreshPluginSiteDomains().then(() => {
  void siteAccess.syncPromptNudgeIcon();
});

// Initial fetch interceptor registration
void mainWorld.registerFetchInterceptor();

// Initial response completion observer registration
void mainWorld.syncResponseCompleteObserverRegistration();

registerBackgroundSettingListeners({ siteAccess, mainWorld });

const starStore = createStarStore(chrome.storage.local);
const handleStarredMessage = createStarredMessagesHandler(starStore);
const forkMessages = createForkMessagesOwner(chrome.storage.local);
const handleCloudSyncMessage = guardDriveWithoutSignIn(
  createCloudSyncMessageHandler({
    starStore,
    getAllStarredMessages: starStore.getAll,
    getAllForkNodes: forkMessages.getAllForkNodes,
  }),
);

registerBackgroundRuntimeMessages({
  handlePluginMessage: (message, sender) =>
    handlePluginRuntimeMessage(message, sender, {
      syncContentScripts: siteAccess.syncPlugins,
      refreshCatalog: (host, force) => hostCatalogRefresher.refresh(host, { force }),
    }),
  handleGeneratedUiMessage: generatedUiCapture.handle,
  handleNotificationMessage: (message, sender) =>
    notificationEnablement?.handle(message, sender) ??
    responseNotifications.handle(message, sender),
  handleStarredMessage,
  handleForkMessage: forkMessages.handle,
  handleCloudSyncMessage,
  handleBridgeMessage,
  announcements: remoteAnnouncementService,
});
