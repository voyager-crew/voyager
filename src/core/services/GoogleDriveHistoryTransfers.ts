import type { DriveHistoryRestoreFile, DriveHistoryRestoreTarget } from '@/core/types/driveHistory';
import type { SyncPlatform } from '@/core/types/sync';
import type { CloudUploadReceipt } from '@/core/types/syncUploadReceipt';
import {
  FOLDER_PLATFORMS,
  FOLDER_PLATFORM_IDS,
  supportsAccountIsolation,
  type AccountScopedFolderPlatform,
} from '@/features/folder/platforms';

import { CloudSyncFailure } from './CloudSyncFailure';
import type { GoogleDriveAuth } from './GoogleDriveAuth';
import { isDriveSyncFileName } from './GoogleDriveHistoryPayload';
import { AccountUnconfirmedError, GoogleDriveIdentity } from './GoogleDriveIdentity';
import {
  HIGHLIGHTS_FILE_NAME,
  PLUGINS_FILE_NAME,
  PROMPTS_FILE_NAME,
  SETTINGS_FILE_NAME,
} from './GoogleDriveSyncFileNames';
import type { GoogleDriveSyncSession } from './GoogleDriveSyncSession';
import type { GoogleDriveUploadFiles } from './GoogleDriveUploadFiles';

export function driveHistoryBaseName(name: string): string {
  return name.replace(/\.acct-[a-z0-9]+(?=\.json$)/, '');
}

/** Restore uses the same global files and account-capable owners as upload naming. */
export function driveHistoryAccountPlatform(
  name: string,
  requestedPlatform?: SyncPlatform,
): AccountScopedFolderPlatform | null {
  const base = driveHistoryBaseName(name);
  const folderPlatform = FOLDER_PLATFORM_IDS.find(
    (candidate) => FOLDER_PLATFORMS[candidate].driveFoldersFileName === base,
  );
  if (folderPlatform) return supportsAccountIsolation(folderPlatform) ? folderPlatform : null;
  if (
    base === SETTINGS_FILE_NAME ||
    base === PLUGINS_FILE_NAME ||
    /^gemini-voyager-(?:timeline-hierarchy|stars)\.site-/.test(base)
  )
    return null;
  if (
    base === PROMPTS_FILE_NAME &&
    requestedPlatform !== undefined &&
    FOLDER_PLATFORMS[requestedPlatform].syncsSharedData &&
    supportsAccountIsolation(requestedPlatform)
  )
    return requestedPlatform;
  return (
    FOLDER_PLATFORM_IDS.find(
      (platform): platform is AccountScopedFolderPlatform =>
        supportsAccountIsolation(platform) && FOLDER_PLATFORMS[platform].syncsConversationExtras,
    ) ?? null
  );
}

export async function restoreDrivePreviousVersion(
  options: {
    auth: Pick<GoogleDriveAuth, 'getToken'>;
    session: GoogleDriveSyncSession;
    identity: GoogleDriveIdentity;
    uploads: GoogleDriveUploadFiles;
  },
  targets: readonly DriveHistoryRestoreTarget[],
  interactive = true,
  receipt?: CloudUploadReceipt,
): Promise<DriveHistoryRestoreFile[]> {
  const names = targets.map(({ name }) => name);
  if (names.some((name) => !isDriveSyncFileName(name))) throw new Error('invalid_sync_files');
  // An upload's Undo writes only to the Drive the upload wrote to. A session bound to another
  // account refuses at once; an unbound one is bound to the upload's, so the native side refuses
  // each request while the app holds another account.
  const driveAccount = receipt?.driveAccount;
  if (driveAccount) {
    const bound = options.session.driveAccount;
    if (bound !== null && bound !== driveAccount)
      throw new CloudSyncFailure('account_changed', 'The upload went to another Google account');
    options.session.bindDriveAccount(driveAccount);
  }
  const authorities = targets.map(({ name, accountScope }) => ({
    name,
    scope: driveHistoryAccountPlatform(name) ? accountScope : null,
  }));
  await options.identity.capture(...authorities.map(({ scope }) => scope));
  for (const { name, scope } of authorities) {
    const base = driveHistoryBaseName(name);
    // A base or legacy route file must never replace the account's canonical email file.
    if ((base === HIGHLIGHTS_FILE_NAME && !scope) || options.identity.name(base, scope) !== name)
      throw new AccountUnconfirmedError();
  }
  const token = await options.session.run(() => options.auth.getToken(interactive, false));
  if (!token) return names.map((name) => ({ name, status: 'read_failed' }));
  options.uploads.setBeforeFirstWrite(async () => {
    await options.session.run(() => options.auth.getToken(interactive));
  });
  return options.session.run(() => options.uploads.restoreHistory(token, names, receipt));
}
