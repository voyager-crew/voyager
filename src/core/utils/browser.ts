/**
 * Browser detection utilities
 * Provides reliable browser detection for Safari-specific handling
 */

/**
 * Detect if the current browser is Safari
 *
 * Detection strategy:
 * 1. Check for Safari-specific vendor string (Apple Inc.)
 * 2. Ensure 'safari' is in user agent
 * 3. Ensure it's not Chrome/Chromium (which also uses webkit)
 *
 * Note: Do not rely on global objects (browser/chrome) for detection,
 * as webextension-polyfill makes browser available in all browsers,
 * and Firefox provides both browser and chrome objects.
 *
 * @returns true if running in Safari
 */
const IOS_THIRD_PARTY_BROWSER_UA_PATTERN = /\b(?:CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave|GSA)\//i;

export function isSafari(): boolean {
  // Reliable detection using user agent and vendor
  const ua = navigator.userAgent?.toLowerCase() ?? '';
  const vendor = navigator.vendor?.toLowerCase() ?? '';

  // iOS browsers all use WebKit and can expose Apple's vendor plus a Safari
  // token. Their product-specific tokens must win over that shared shape.
  if (IOS_THIRD_PARTY_BROWSER_UA_PATTERN.test(ua)) return false;

  // Safari has 'Apple' vendor and 'safari' in UA, but not 'chrome'
  const isAppleVendor = vendor.includes('apple');
  const hasSafariUA = ua.includes('safari');
  const notChrome = !ua.includes('chrome') && !ua.includes('chromium');

  return isAppleVendor && hasSafariUA && notChrome;
}

/**
 * Check if update reminders should be shown on Safari
 * This is controlled by the ENABLE_SAFARI_UPDATE_CHECK environment variable at build time
 *
 * @returns true if Safari update reminders are enabled
 */
export function shouldShowSafariUpdateReminder(): boolean {
  if (!isSafari()) return false;

  // Check build-time flag (injected via vite config)
  // Default: false (disabled)
  try {
    return import.meta.env.ENABLE_SAFARI_UPDATE_CHECK === 'true';
  } catch {
    return false;
  }
}

/**
 * Detect if the current browser is Brave.
 * Brave adds navigator.brave in all contexts including service workers.
 * Used to skip chrome.identity.getAuthToken which shows an error popup on Brave.
 */
export function isBrave(): boolean {
  return 'brave' in navigator;
}

/**
 * Detect if the current browser is Chrome (not Edge, Firefox, or Safari).
 * Used to conditionally show Chrome Web Store rating prompts.
 */
export function isChrome(): boolean {
  if (isSafari()) return false;
  const ua = navigator.userAgent.toLowerCase();
  return (
    (ua.includes('chrome') || ua.includes('chromium')) &&
    !ua.includes('edg') &&
    !ua.includes('firefox')
  );
}

/**
 * Detect if the current browser is Firefox.
 */
export function isFirefox(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('firefox');
}

/**
 * Parse the Firefox major version from the user agent, or 0 if unavailable.
 */
function getFirefoxMajorVersion(): number {
  const match = navigator.userAgent.match(/Firefox\/(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Whether this browser honors the MV3 `optional_host_permissions` manifest key,
 * i.e. whether `permissions.request({ origins })` for an optional host can
 * actually be granted. Chrome/Edge: yes. Firefox: only from 128 (Bugzilla
 * 1766026) — older Firefox installs but ignores the key, so the request would
 * silently fail. Safari is gated separately via isSafari().
 *
 * Used to feature-gate the plugin / custom-website host-grant flows with a clear
 * "unsupported" message instead of a misleading "denied" on older Firefox.
 */
export function supportsOptionalHostPermissions(): boolean {
  if (isFirefox()) {
    return getFirefoxMajorVersion() >= 128;
  }
  return true;
}

/**
 * Whether this browser release can follow optional host access with persistent
 * dynamic content script registration, decided by browser and version alone so
 * it holds in any frame: Firefox from 128, Safari from 16.4. Extension contexts
 * can expose a reduced Safari UA; that counts as supported, and the runtime
 * probe in `supportsDynamicContentScriptRegistration` decides there.
 */
export function browserSupportsDynamicContentScriptRegistration(): boolean {
  if (!supportsOptionalHostPermissions()) return false;

  const safariBuild = getVoyagerBuildTarget() === 'safari' || isSafari();
  if (!safariBuild) return true;

  const match = (navigator.userAgent ?? '').match(/\bVersion\/(\d+)(?:\.(\d+))?/i);
  if (!match) return true;

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2] ?? '0', 10);
  return major > 16 || (major === 16 && minor >= 4);
}

/**
 * Whether optional host access can be followed by persistent dynamic content
 * script registration from this frame: the browser supports it and this frame
 * exposes `chrome.scripting`. Firefox's in-page panel frame lacks `scripting`
 * on a browser that supports it, so a caller deciding for the browser itself
 * uses `browserSupportsDynamicContentScriptRegistration`.
 */
export function supportsDynamicContentScriptRegistration(): boolean {
  if (!browserSupportsDynamicContentScriptRegistration()) return false;

  const extensionGlobal = globalThis as {
    chrome?: {
      scripting?: {
        registerContentScripts?: unknown;
        unregisterContentScripts?: unknown;
      };
    };
  };
  const scripting = extensionGlobal.chrome?.scripting;
  return (
    typeof scripting?.registerContentScripts === 'function' &&
    typeof scripting.unregisterContentScripts === 'function'
  );
}

/**
 * Detect whether this extension runtime exposes the WebExtensions notifications
 * API. Safari response notifications use the native Swift bridge instead.
 */
export function supportsExtensionNotifications(): boolean {
  if (isSafari()) return false;

  const extensionGlobal = globalThis as {
    chrome?: {
      notifications?: {
        create?: unknown;
      };
    };
  };

  return typeof extensionGlobal.chrome?.notifications?.create === 'function';
}

export const CHROME_WEB_STORE_EXTENSION_ID = 'iifacdnjakkhjjiengaffnegbndgingi';
export const EDGE_ADDONS_EXTENSION_ID = 'gibmkggjijalcjinbdhcpklodjkhhlne';

export type VoyagerBuildTarget = 'chrome' | 'edge' | 'firefox' | 'safari';
export type WebStoreRatingChannel = 'chrome' | 'edge';

/**
 * The release channel this bundle was built for. Runtime browser detection is
 * intentionally separate: Edge can run the Chrome Web Store build, and local
 * Edge test builds do not have the Edge Add-ons store id.
 */
export function getVoyagerBuildTarget(): VoyagerBuildTarget {
  try {
    const target = import.meta.env.VOYAGER_BUILD_TARGET;
    if (target === 'edge' || target === 'firefox' || target === 'safari') return target;
  } catch {
    // import.meta.env can be unavailable in non-Vite test contexts.
  }

  return 'chrome';
}

/**
 * Parse Safari's product major version from the `Version/x` user-agent token.
 *
 * The Safari build target is authoritative because extension contexts can
 * expose reduced user-agent/vendor values. The user agent is used only for the
 * product version: WebKit/Safari engine build numbers are not Safari versions.
 * Unknown or third-party iOS browsers return null instead of guessing.
 */
export function getSafariMajorVersion(): number | null {
  const ua = navigator.userAgent ?? '';

  if (IOS_THIRD_PARTY_BROWSER_UA_PATTERN.test(ua)) return null;
  if (getVoyagerBuildTarget() !== 'safari' && !isSafari()) return null;

  const match = ua.match(/\bVersion\/(\d+)(?:\.\d+)?/i);
  if (!match) return null;

  const majorVersion = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(majorVersion) && majorVersion > 0 ? majorVersion : null;
}

/**
 * Safari before 16 keeps browser.storage.local quota-limited even when the
 * unlimitedStorage permission is granted. Unknown versions are not assumed to
 * be legacy; callers should use a generic fallback message in that case.
 */
export function hasLegacySafariStorageLimit(): boolean {
  const majorVersion = getSafariMajorVersion();
  return majorVersion !== null && majorVersion < 16;
}

export function getExtensionRuntimeId(): string | undefined {
  const extensionGlobal = globalThis as {
    chrome?: {
      runtime?: {
        id?: string;
      };
    };
  };

  return extensionGlobal.chrome?.runtime?.id;
}

/**
 * Detect whether the currently installed extension is from Edge Add-ons.
 * This must use the runtime id instead of the browser user agent: Edge users can
 * install the Chrome Web Store build, and those installs should behave like the
 * normal Chrome release channel.
 */
export function isEdgeAddonsInstall(): boolean {
  return getExtensionRuntimeId() === EDGE_ADDONS_EXTENSION_ID;
}

/**
 * @deprecated Use isEdgeAddonsInstall for the accurate runtime/install semantic.
 */
export function isEdgeAddonsBuild(): boolean {
  return isEdgeAddonsInstall();
}

export function isChromeWebStoreInstall(): boolean {
  return getExtensionRuntimeId() === CHROME_WEB_STORE_EXTENSION_ID;
}

export function isChromeWebStoreInstallOnEdge(): boolean {
  return isEdge() && isChromeWebStoreInstall();
}

export function isChromeReleaseChannel(): boolean {
  return getVoyagerBuildTarget() === 'chrome' && !isEdgeAddonsInstall();
}

/**
 * Detect whether this bundle should follow the Edge release-channel behavior.
 * Covers both published Edge Add-ons installs and locally built Edge packages.
 */
export function isEdgeReleaseChannel(): boolean {
  return getVoyagerBuildTarget() === 'edge' || isEdgeAddonsInstall();
}

/**
 * @deprecated Use isEdgeReleaseChannel for the clearer release-channel semantic.
 */
export function isEdgeBuild(): boolean {
  return isEdgeReleaseChannel();
}

export function isLocalEdgeBuildInstall(): boolean {
  return getVoyagerBuildTarget() === 'edge' && !isEdgeAddonsInstall();
}

export function getWebStoreRatingChannel(): WebStoreRatingChannel | null {
  if (!isChrome() && !isEdge()) return null;
  if (isEdgeReleaseChannel()) return 'edge';
  if (isChromeReleaseChannel()) return 'chrome';

  return null;
}

/**
 * Detect if the current browser is Microsoft Edge.
 * Edge is Chromium-based and includes 'edg' in the user agent.
 */
export function isEdge(): boolean {
  if (isSafari()) return false;
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('edg');
}

/**
 * Detect if the current platform is macOS
 *
 * @returns true if running on macOS
 */
export function isMac(): boolean {
  // navigator.platform is deprecated but still widely supported and reliable
  // Use it first, then fall back to userAgent
  if (typeof navigator !== 'undefined') {
    if (navigator.platform) {
      return navigator.platform.toUpperCase().includes('MAC');
    }
    return /macintosh|mac os x/i.test(navigator.userAgent);
  }
  return false;
}

/**
 * Get the platform-appropriate modifier key label
 * macOS: ⌘ (Cmd), others: Ctrl
 *
 * @returns '⌘' on macOS, 'Ctrl' on other platforms
 */
export function getModifierKey(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

/**
 * Get browser name for debugging
 * Uses user agent detection for reliability
 */
export function getBrowserName(): string {
  if (isSafari()) return 'Safari';

  if (isFirefox()) return 'Firefox';

  const ua = navigator.userAgent.toLowerCase();

  // Chrome/Edge/Brave have 'chrome' or 'chromium' in UA
  if (ua.includes('chrome') || ua.includes('chromium')) {
    if (ua.includes('edg')) return 'Edge';
    return 'Chrome/Chromium';
  }

  return 'Unknown';
}
