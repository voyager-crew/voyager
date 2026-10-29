/** Shared-data primitives used inside a sync service queue turn. */
import type {
  HighlightExportPayload,
  PromptItem,
  SyncAccountScope,
  SyncState,
} from '@/core/types/sync';
import type { PromptExportPayload } from '@/core/types/sync';
import type { DriveReadResult } from '@/core/utils/driveReadResult';

import type { GoogleDriveAuth } from './GoogleDriveAuth';
import { GoogleDriveSyncPayloads, assertHighlightPayloadForScope } from './GoogleDriveSyncPayloads';
import { GoogleDriveSyncSession, SyncSessionEndedError } from './GoogleDriveSyncSession';
import { logger } from './LoggerService';

export class GoogleDriveSharedTransfers {
  constructor(
    private readonly auth: Pick<GoogleDriveAuth, 'getToken'>,
    private readonly payloads: GoogleDriveSyncPayloads,
    private readonly session: GoogleDriveSyncSession,
    private readonly updateState: (state: Partial<SyncState>) => void,
    private readonly saveState: () => Promise<void>,
  ) {}

  /**
   * Upload ONLY the account-scoped prompts file, leaving folders / settings /
   * starred untouched. Used by the popup "cloud merge" buttons, which merge
   * cloud + local locally first and upload the union so both sides converge
   * without data loss.
   */
  async uploadPromptsOnly(
    prompts: PromptItem[],
    accountScope: SyncAccountScope | null = null,
    interactive: boolean = true,
  ): Promise<boolean> {
    try {
      this.updateState({ isSyncing: true, error: null });

      const token = await this.session.run(() => this.auth.getToken(interactive));
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return false;
        }
        throw new Error('Not authenticated');
      }

      await this.payloads.uploadPrompts(token, prompts, accountScope);

      this.updateState({ isSyncing: false, error: null });
      await this.saveState();
      logger.info('[GoogleDriveSyncService] Prompts-only upload successful');
      return true;
    } catch (error) {
      if (error instanceof SyncSessionEndedError) throw error;
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      console.error('[GoogleDriveSyncService] Prompts-only upload failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return false;
    }
  }

  /**
   * Download ONLY the account-scoped prompts file. Distinguishes absent, unrecognized
   * and failed reads from a recognized payload. The caller is
   * responsible for merging the result into local data.
   */
  async downloadPromptsOnly(
    accountScope: SyncAccountScope | null = null,
    interactive: boolean = true,
    purpose: 'download' | 'upload' = 'download',
  ): Promise<DriveReadResult<PromptExportPayload>> {
    try {
      this.updateState({ isSyncing: true, error: null });

      const token = await this.session.run(() =>
        this.auth.getToken(interactive, purpose !== 'upload'),
      );
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return { kind: 'failed', error: new Error('Not authenticated') };
        }
        throw new Error('Not authenticated');
      }

      const prompts = await this.payloads.downloadPrompts(token, accountScope);

      if (prompts.kind === 'failed') throw prompts.error;
      if (prompts.kind === 'unrecognized') {
        this.updateState({
          isSyncing: false,
          error: purpose === 'upload' ? null : 'Download failed',
        });
        return prompts;
      }
      this.updateState({ isSyncing: false, error: null });
      return prompts;
    } catch (error) {
      if (error instanceof SyncSessionEndedError) throw error;
      const errorMessage = error instanceof Error ? error.message : 'Download failed';
      console.error('[GoogleDriveSyncService] Prompts-only download failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return { kind: 'failed', error };
    }
  }

  /**
   * Upload only the account-scoped highlight payload. Highlights intentionally
   * live in their own file and are never added to the legacy SyncData aggregate.
   *
   * This primitive is last-write-wins. Drive v3's documented media-update API
   * does not expose a reliable compare-and-swap revision contract here, so
   * callers must download/merge before uploading when concurrent edits matter.
   */
  async uploadHighlightsOnly(
    payload: HighlightExportPayload,
    accountScope: SyncAccountScope,
    interactive: boolean = true,
  ): Promise<boolean> {
    try {
      this.updateState({ isSyncing: true, error: null });
      assertHighlightPayloadForScope(payload, accountScope);

      const token = await this.session.run(() => this.auth.getToken(interactive));
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return false;
        }
        throw new Error('Not authenticated');
      }

      await this.payloads.uploadHighlights(token, payload, accountScope);

      this.updateState({ isSyncing: false, error: null });
      await this.saveState();
      return true;
    } catch (error) {
      if (error instanceof SyncSessionEndedError) throw error;
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      console.error('[GoogleDriveSyncService] Highlights-only upload failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return false;
    }
  }

  /**
   * Download only the exact account-scoped highlight file. Unlike older sync
   * payloads, there is deliberately no fallback to an unscoped legacy file:
   * highlights have been account-isolated since their first Drive format.
   */
  async downloadHighlightsOnly(
    accountScope: SyncAccountScope,
    interactive: boolean = true,
    purpose: 'download' | 'upload' = 'download',
  ): Promise<HighlightExportPayload | null> {
    try {
      this.updateState({ isSyncing: true, error: null });

      const token = await this.session.run(() =>
        this.auth.getToken(interactive, purpose !== 'upload'),
      );
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return null;
        }
        throw new Error('Not authenticated');
      }

      const downloaded = await this.payloads.downloadHighlights(token, accountScope);
      this.updateState({ isSyncing: false, error: null });
      return downloaded;
    } catch (error) {
      if (error instanceof SyncSessionEndedError) throw error;
      const errorMessage = error instanceof Error ? error.message : 'Download failed';
      console.error('[GoogleDriveSyncService] Highlights-only download failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return null;
    }
  }
}
