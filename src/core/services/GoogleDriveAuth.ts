import { runGoogleWebAuthFlow } from '@/core/services/googleOAuthWebFlow';
import type { SyncProvider } from '@/core/types/sync';
import { getVoyagerBuildTarget, isBrave, isSafari } from '@/core/utils/browser';
import {
  requestSafariGoogleDriveSession,
  signOutSafariGoogleDrive,
} from '@/core/utils/safariGoogleDrive';
import { checkSafariICloudAccount } from '@/core/utils/safariICloudSync';

import { logger } from './LoggerService';

const IDENTITY_TOKEN_TTL_SECONDS = 55 * 60;

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function isSafariRuntime(): boolean {
  return getVoyagerBuildTarget() === 'safari' || isSafari();
}

/** Owns token expiry, worker cache recovery and browser/native authentication. */
export class GoogleDriveAuth {
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private pendingTokenPersistence: { gvAccessToken: string; gvTokenExpiry: number } | null = null;

  constructor(private readonly getProvider: () => SyncProvider) {}

  async signOutGoogle(): Promise<void> {
    try {
      if (isSafariRuntime()) {
        await signOutSafariGoogleDrive();
      } else if (this.accessToken) {
        await this.removeCachedAuthToken(this.accessToken);
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${this.accessToken}`);
      }
    } catch (error) {
      console.warn('[GoogleDriveSyncService] Sign out warning:', error);
    }
  }

  private async loadCachedToken(): Promise<void> {
    if (isSafariRuntime()) return;

    try {
      const result = await chrome.storage.local.get(['gvAccessToken', 'gvTokenExpiry']);
      const cachedAccessToken = getStringValue(result.gvAccessToken);
      const cachedTokenExpiry = getNumberValue(result.gvTokenExpiry);
      if (cachedAccessToken && cachedTokenExpiry && cachedTokenExpiry > Date.now()) {
        this.accessToken = cachedAccessToken;
        this.tokenExpiry = cachedTokenExpiry;
        this.pendingTokenPersistence = null;
        logger.info('[GoogleDriveSyncService] Loaded cached token');
      }
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to load cached token:', error);
    }
  }

  private async saveToken(token: string, expiresIn: number, persist: boolean): Promise<void> {
    this.accessToken = token;
    this.tokenExpiry = Date.now() + expiresIn * 1000 - 60000;
    if (isSafariRuntime()) return;

    // A refused preflight leaves storage intact; an allowed transfer persists this same expiry.
    this.pendingTokenPersistence = { gvAccessToken: token, gvTokenExpiry: this.tokenExpiry };
    if (persist) await this.persistPendingToken();
  }

  private async persistPendingToken(): Promise<void> {
    const pending = this.pendingTokenPersistence;
    if (!pending) return;
    try {
      await chrome.storage.local.set(pending);
      if (this.pendingTokenPersistence === pending) this.pendingTokenPersistence = null;
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to save token:', error);
    }
  }

  async clear(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.pendingTokenPersistence = null;
    try {
      await chrome.storage.local.remove(['gvAccessToken', 'gvTokenExpiry']);
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to clear token:', error);
    }
  }

  private isUserDeniedAuthError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('did not approve access') ||
      normalized.includes('user denied') ||
      normalized.includes('access_denied')
    );
  }

  private extractIdentityToken(result: unknown): string | null {
    if (typeof result === 'string' && result.trim()) {
      return result;
    }

    if (typeof result === 'object' && result !== null) {
      const token = (result as { token?: unknown }).token;
      if (typeof token === 'string' && token.trim()) {
        return token;
      }
    }

    return null;
  }

  private async requestIdentityAuthToken(
    interactive: boolean,
    persist: boolean,
  ): Promise<{ token: string | null; userDenied: boolean }> {
    const identity = chrome.identity;
    if (!identity?.getAuthToken) {
      return { token: null, userDenied: false };
    }

    try {
      const tokenResult = await new Promise<unknown>((resolve, reject) => {
        identity.getAuthToken({ interactive }, (token) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(token);
          }
        });
      });

      const token = this.extractIdentityToken(tokenResult);
      if (!token) {
        return { token: null, userDenied: false };
      }

      // getAuthToken does not provide expiry; keep a short TTL and persist for worker restarts.
      await this.saveToken(token, IDENTITY_TOKEN_TTL_SECONDS, persist);
      return { token, userDenied: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const userDenied = this.isUserDeniedAuthError(message);
      if (!userDenied) {
        console.warn('[GoogleDriveSyncService] identity.getAuthToken failed:', error);
      }
      return { token: null, userDenied };
    }
  }

  private async getTokenFromIdentity(
    interactive: boolean,
    persist: boolean,
  ): Promise<{ token: string | null; userDenied: boolean }> {
    if (!chrome.identity?.getAuthToken) {
      return { token: null, userDenied: false };
    }

    const nonInteractiveResult = await this.requestIdentityAuthToken(false, persist);
    if (nonInteractiveResult.token) {
      return nonInteractiveResult;
    }

    if (!interactive) {
      return { token: null, userDenied: false };
    }

    return this.requestIdentityAuthToken(true, persist);
  }

  private async removeCachedAuthToken(token: string): Promise<void> {
    const identity = chrome.identity;
    if (!identity?.removeCachedAuthToken) {
      return;
    }

    await new Promise<void>((resolve) => {
      identity.removeCachedAuthToken({ token }, () => resolve());
    });
  }

  private async getTokenFromLegacyWebAuthFlow(persist: boolean): Promise<string | null> {
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2?.client_id;
    const scopes = manifest.oauth2?.scopes?.join(' ');

    if (!clientId || !scopes) {
      console.error('[GoogleDriveSyncService] Missing oauth2 config');
      return null;
    }

    try {
      const granted = await runGoogleWebAuthFlow({
        clientId,
        scopes,
        redirectURL: chrome.identity.getRedirectURL(),
        launch: (url) =>
          new Promise<string>((resolve, reject) => {
            chrome.identity.launchWebAuthFlow({ url, interactive: true }, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (response) {
                resolve(response);
              } else {
                reject(new Error('No response from auth flow'));
              }
            });
          }),
      });
      if (!granted) return null;
      await this.saveToken(granted.accessToken, granted.expiresIn, persist);
      return granted.accessToken;
    } catch (error) {
      console.error('[GoogleDriveSyncService] Auth flow failed:', error);
      return null;
    }
  }

  async getToken(interactive: boolean, persist: boolean = true): Promise<string | null> {
    if (this.getProvider() === 'icloud') {
      await checkSafariICloudAccount();
      return 'icloud';
    }

    if (isSafariRuntime()) {
      const nativeSession = await requestSafariGoogleDriveSession(interactive);
      if (nativeSession.signedIn) {
        return 'safari-native';
      }
      if (nativeSession.requiresAppLaunch) {
        throw new Error('Open Voyager to connect Google Drive, then try again.');
      }
      return null;
    }

    if (this.accessToken && this.tokenExpiry > Date.now()) {
      if (persist) await this.persistPendingToken();
      return this.accessToken;
    }

    if (this.accessToken && this.tokenExpiry <= Date.now()) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      this.pendingTokenPersistence = null;
    }

    await this.loadCachedToken();
    if (this.accessToken && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    // Brave supports the identity API but chrome.identity.getAuthToken shows
    // an "Access blocked" error popup before failing, causing user confusion.
    // Skip it entirely on Brave and go directly to launchWebAuthFlow.
    const supportsIdentityApi = !!chrome.identity?.getAuthToken && !isBrave();
    if (supportsIdentityApi) {
      const identityResult = await this.getTokenFromIdentity(interactive, persist);
      if (identityResult.token) {
        return identityResult.token;
      }

      if (!interactive) {
        return null;
      }

      // Fallback: always try launchWebAuthFlow when getAuthToken fails.
      // Some browsers (Arc) or Chrome versions may show an OAuth error page
      // during getAuthToken, which looks like "user denied" when dismissed,
      // but launchWebAuthFlow with a registered redirect URI can still succeed.
      return this.getTokenFromLegacyWebAuthFlow(persist);
    }

    if (!interactive) {
      return null;
    }

    return this.getTokenFromLegacyWebAuthFlow(persist);
  }
}
