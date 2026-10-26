/**
 * Development-only settings bridge for the unpacked `dist_chrome_dev` build.
 *
 * An agent driving the browser can run scripts in the page but cannot open the
 * popup (extension pages are out of its reach), so it could not turn a setting
 * on to verify it. Page scripts post a request here and the content script,
 * which can reach extension storage, applies it:
 *
 *   window.postMessage({ source: 'gv-dev-settings', id: 1, action: 'set',
 *     values: { gvResponseCompleteNotificationEnabled: true } }, location.origin);
 *
 * `get` reads the listed keys (every known key when `keys` is omitted), and
 * `remove` deletes them, which is how a never-set setting is reproduced. `area`
 * is `'sync'` (default) or `'local'`. The reply is posted back with source
 * `'gv-dev-settings-result'` and the same `id`. Writes reach storage only:
 * popup-side steps such as permission prompts do not run.
 *
 * `{ area: 'local', action: 'set', values: { gvDevFormFactor: 'mobile' } }`
 * makes this desktop act as a phone (`core/utils/formFactor.ts`) from the next
 * page load; `remove` it to go back.
 *
 * In `area: 'local'`, `gvPluginHostCatalog:<host>` reads, writes or removes one host's
 * plugin catalog cache (`features/plugins/remote/hostCatalogCache.ts`), so a
 * live check can inject a catalog entry.
 *
 * Any script on the page can post here, so only `StorageKeys` values (and the
 * dev form-factor key) are accepted, plus, in `local` only, the catalog prefix
 * followed by a host the extension keeps a catalog for
 * (`isEligibleCatalogHost`); nothing else under the prefix. Callers must guard
 * `startDevSettingsBridge()` with `import.meta.env.VOYAGER_DEV_SETTINGS_BRIDGE`
 * so production bundles drop it.
 */
import { StorageKeys } from '@/core/types/common';
import { hasValidExtensionContext } from '@/core/utils/extensionContext';
import { DEV_FORM_FACTOR_KEY } from '@/core/utils/formFactor';
import { isEligibleCatalogHost } from '@/features/plugins/remote/hostCatalogPolicy';

export const DEV_SETTINGS_REQUEST_SOURCE = 'gv-dev-settings';
export const DEV_SETTINGS_RESULT_SOURCE = 'gv-dev-settings-result';

// Plus the dev-only device override, which exists only in builds that carry this bridge.
const KNOWN_KEYS: readonly string[] = [...Object.values(StorageKeys), DEV_FORM_FACTOR_KEY];

type Area = 'sync' | 'local';

export type DevSettingsResult =
  | { ok: true; values?: Record<string, unknown> }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One host's plugin catalog cache key, which only `chrome.storage.local` holds. */
function isHostCatalogKey(key: string): boolean {
  const prefix = StorageKeys.PLUGIN_HOST_CATALOG_PREFIX;
  return key.startsWith(prefix) && isEligibleCatalogHost(key.slice(prefix.length));
}

function unknownKeys(keys: string[], area: Area): string[] {
  return keys.filter(
    (key) => !KNOWN_KEYS.includes(key) && !(area === 'local' && isHostCatalogKey(key)),
  );
}

export async function handleDevSettingsRequest(
  request: Record<string, unknown>,
): Promise<DevSettingsResult> {
  const area: Area | null =
    request.area === undefined || request.area === 'sync'
      ? 'sync'
      : request.area === 'local'
        ? 'local'
        : null;
  if (!area) return { ok: false, error: 'area must be "sync" or "local"' };
  const storage: chrome.storage.StorageArea = chrome.storage[area];

  if (request.action === 'get' || request.action === 'remove') {
    const removing = request.action === 'remove';
    const keys =
      request.keys === undefined && !removing
        ? [...KNOWN_KEYS]
        : Array.isArray(request.keys) && request.keys.every((key) => typeof key === 'string')
          ? request.keys
          : null;
    if (!keys) return { ok: false, error: 'keys must be a list of setting names' };
    const rejected = unknownKeys(keys, area);
    if (rejected.length) return { ok: false, error: `unknown keys: ${rejected.join(', ')}` };
    if (!removing) return { ok: true, values: await storage.get<Record<string, unknown>>(keys) };
    await storage.remove(keys);
    return { ok: true };
  }

  if (request.action === 'set') {
    if (!isRecord(request.values)) return { ok: false, error: 'values must be an object' };
    const rejected = unknownKeys(Object.keys(request.values), area);
    if (rejected.length) return { ok: false, error: `unknown keys: ${rejected.join(', ')}` };
    await storage.set(request.values);
    return { ok: true };
  }

  return { ok: false, error: 'action must be "get", "set" or "remove"' };
}

export function startDevSettingsBridge(): () => void {
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== window) return;
    const request: unknown = event.data;
    if (!isRecord(request) || request.source !== DEV_SETTINGS_REQUEST_SOURCE) return;
    // A content script orphaned by an extension reload stays silent and leaves the reply to the live one.
    if (!hasValidExtensionContext()) return;
    void handleDevSettingsRequest(request)
      .catch((error: unknown): DevSettingsResult => ({ ok: false, error: String(error) }))
      .then((result) =>
        window.postMessage(
          { source: DEV_SETTINGS_RESULT_SOURCE, id: request.id, ...result },
          location.origin,
        ),
      );
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
