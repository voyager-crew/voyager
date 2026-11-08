import { StorageKeys } from '@/core/types/common';
import {
  type ChangelogNotifyMode,
  parseChangelogNotifyMode,
} from '@/core/utils/changelogNotifyMode';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { getCurrentLanguage } from '@/utils/i18n';
import type { AppLanguage } from '@/utils/language';
import { loadTranslations } from '@/utils/translations';

import { closeChangelogModal, createChangelogModal } from './modal';
import {
  noteBody,
  notePath,
  pickNoteLocale,
  unseenNoteVersions,
  withoutOpeningQuote,
} from './noteSections';

/**
 * One loader per language file, e.g. './notes/2.2.0/en.md'.
 * Lazy so a release loads only the language it shows.
 */
const changelogModules = import.meta.glob('./notes/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: false,
}) as Record<string, () => Promise<string>>;

/** Every release with a note, from the note folders' names. */
const NOTED_VERSIONS = [
  ...new Set(Object.keys(changelogModules).map((path) => path.split('/')[2] ?? '')),
].filter(Boolean);

/**
 * Versions whose changelog must show as a popup even for users who chose the
 * NEW mark or no reminder. Reserved for releases the maintainer wants every user to
 * actually read — e.g. when Gemini ships a major UI overhaul that breaks
 * assumptions and a quiet badge would let users miss critical context.
 *
 * Effect: bypasses the notify-mode early-return in startChangelog. The user's
 * CHANGELOG_NOTIFY_MODE preference is preserved untouched for future releases.
 */
const FORCE_POPUP_VERSIONS: ReadonlySet<string> = new Set(['1.4.5']);

/**
 * Seconds the close controls remain disabled after the modal opens for a
 * force-popup version, so users actually skim the notes before dismissing.
 * Only applies to FORCE_POPUP_VERSIONS — regular releases close immediately.
 */
const FORCE_POPUP_READ_GATE_SECONDS = 15;

const MARKDOWN_IMAGE_URL_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
const MARKDOWN_DOC_LINK_REGEX = /\[([^\]]*)\]\((\/guide\/[^\s)]+)\)/g;

const GITHUB_PROMOTION_PATH_PREFIX = '/voyager-crew/voyager/raw/main/docs/public/assets/promotion/';
const RAW_GITHUBUSERCONTENT_PROMOTION_PATH_PREFIX =
  '/voyager-crew/voyager/main/docs/public/assets/promotion/';
function getPromotionRuntimePath(filename: string): string | null {
  switch (filename) {
    case 'Activity-View.png':
      return 'changelog-activity-view.png';
    default:
      return null;
  }
}

function getRuntimeUrl(path: string): string | null {
  try {
    const runtime = (
      globalThis as typeof globalThis & {
        browser?: { runtime?: { getURL?: (assetPath: string) => string } };
        chrome?: { runtime?: { getURL?: (assetPath: string) => string } };
      }
    ).browser?.runtime;
    const fallbackRuntime = (
      globalThis as typeof globalThis & {
        chrome?: { runtime?: { getURL?: (assetPath: string) => string } };
      }
    ).chrome?.runtime;
    const getUrl = runtime?.getURL ?? fallbackRuntime?.getURL;
    return typeof getUrl === 'function' ? getUrl(path) : null;
  } catch {
    return null;
  }
}

function extractPromotionRuntimePath(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;
  const isGithubPromotionImage =
    (host === 'github.com' && pathname.startsWith(GITHUB_PROMOTION_PATH_PREFIX)) ||
    (host === 'raw.githubusercontent.com' &&
      pathname.startsWith(RAW_GITHUBUSERCONTENT_PROMOTION_PATH_PREFIX));
  if (!isGithubPromotionImage) return null;

  const filename = pathname.split('/').pop();
  return filename ? getPromotionRuntimePath(filename) : null;
}

export function resolveChangelogImageUrl(
  url: string,
  runtimeUrlResolver: (path: string) => string | null = getRuntimeUrl,
): string {
  try {
    const parsed = new URL(url);
    const runtimePath = extractPromotionRuntimePath(parsed);
    if (!runtimePath) return url;

    const runtimeUrl = runtimeUrlResolver(runtimePath);
    return runtimeUrl ?? url;
  } catch {
    return url;
  }
}

export function rewriteChangelogImageUrls(
  markdown: string,
  runtimeUrlResolver: (path: string) => string | null = getRuntimeUrl,
  shouldRewrite: boolean = true,
): string {
  if (!shouldRewrite) return markdown;

  return markdown.replace(MARKDOWN_IMAGE_URL_REGEX, (full, alt, url) => {
    const resolvedUrl = resolveChangelogImageUrl(url, runtimeUrlResolver);
    if (resolvedUrl === url) return full;
    return `![${alt}](${resolvedUrl})`;
  });
}

/**
 * Rewrite relative doc links (e.g. `/guide/timeline`) in changelog markdown
 * to full locale-aware URLs (e.g. `https://voyager.nagi.fun/ja/guide/timeline`).
 * zh is the root locale and gets no prefix.
 */
export function rewriteChangelogDocUrls(markdown: string, lang: AppLanguage): string {
  const base = 'https://voyager.nagi.fun';
  return markdown.replace(MARKDOWN_DOC_LINK_REGEX, (_full, text, path) => {
    const url = lang === 'zh' ? `${base}${path}` : `${base}/${lang}${path}`;
    return `[${text}](${url})`;
  });
}

/**
 * Read the current changelog notification mode.
 */
async function readNotifyMode(): Promise<ChangelogNotifyMode> {
  try {
    const result = await chrome.storage.local.get(StorageKeys.CHANGELOG_NOTIFY_MODE);
    return parseChangelogNotifyMode(result[StorageKeys.CHANGELOG_NOTIFY_MODE]);
  } catch {
    return 'popup';
  }
}

/** A release's note in `lang` (English as the fallback), without front matter; null when none. */
async function loadNoteBody(version: string, lang: AppLanguage): Promise<string | null> {
  const locale = pickNoteLocale(lang, (language) =>
    Boolean(changelogModules[`./notes/${notePath(version, language)}`]),
  );
  const loader = locale ? changelogModules[`./notes/${notePath(version, locale)}`] : undefined;
  if (!loader) return null;
  return noteBody(await loader()) || null;
}

/**
 * Several releases' notes, newest first, each under its version. The newest
 * keeps its opening quote on top; the older ones drop theirs.
 */
function gatherNotes(notes: readonly { version: string; body: string }[]): string {
  return notes
    .map(({ version, body }, index) => {
      const rest = withoutOpeningQuote(body);
      const quote = index === 0 ? body.slice(0, body.length - rest.length).trim() : '';
      return [quote, `## v${version}`, rest].filter(Boolean).join('\n\n');
    })
    .join('\n\n');
}

/**
 * Load and render the changelog modal.
 * @param version - Which version's changelog to show (defaults to EXTENSION_VERSION)
 * @param skipDismissCheck - Skip the dismissed-version check
 * @param applyReadGate - Whether the force-popup read-gate countdown should
 *   engage. True for the auto-popup on page load; false for re-opens from
 *   the prompt manager (the user has already seen this once, no need to
 *   gate them again). An auto-popup also carries the notify-mode hint.
 */
async function showChangelogModal(
  version = EXTENSION_VERSION,
  skipDismissCheck = false,
  applyReadGate = true,
): Promise<HTMLDivElement | null> {
  // 1. Check dismissed version. It is also the last release whose notes this person read.
  const stored = await chrome.storage.local.get(StorageKeys.CHANGELOG_DISMISSED_VERSION);
  const dismissedVersion = stored[StorageKeys.CHANGELOG_DISMISSED_VERSION] as string | undefined;
  if (!skipDismissCheck) {
    if (dismissedVersion === EXTENSION_VERSION) return null;
    // First install — user has never seen any changelog, so the current
    // version's notes aren't meaningful.  Silently dismiss and let them
    // explore the extension first.
    if (!dismissedVersion) {
      try {
        await chrome.storage.local.set({
          [StorageKeys.CHANGELOG_DISMISSED_VERSION]: EXTENSION_VERSION,
        });
      } catch {
        // Ignore
      }
      return null;
    }
  }

  // 2. Gather the notes not read yet: updating past a release skipped its popup.
  //    Each in the current language, English as the fallback; a release with
  //    no note, or an empty one, adds nothing.
  const lang = await getCurrentLanguage();
  const unseen =
    version === EXTENSION_VERSION && dismissedVersion
      ? unseenNoteVersions(NOTED_VERSIONS, dismissedVersion, version)
      : [];
  const versions = unseen.length ? unseen : [version];
  const notes = (
    await Promise.all(
      versions.map(async (noteVersion) => ({
        version: noteVersion,
        body: await loadNoteBody(noteVersion, lang),
      })),
    )
  ).filter((note): note is { version: string; body: string } => Boolean(note.body));
  if (!notes.length) return null;

  // 3. One release reads as before; several each sit under their version.
  const extracted =
    notes.length === 1 && notes[0]!.version === version ? notes[0]!.body : gatherNotes(notes);
  const localizedContent = rewriteChangelogDocUrls(
    rewriteChangelogImageUrls(extracted, getRuntimeUrl),
    lang,
  );

  // 4. Convert markdown to HTML
  const [{ marked }, { default: DOMPurify }] = await Promise.all([
    import('marked'),
    import('dompurify'),
    loadTranslations(lang),
  ]);
  const rawHtml = await marked.parse(localizedContent);
  const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      'code',
      'pre',
      'a',
      'img',
      'blockquote',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class'],
    // Changelog images are bundled and resolved to chrome-extension:// or
    // moz-extension:// URLs. DOMPurify's default URI policy allows neither, so
    // without this it silently drops the src and renders a broken image.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|chrome-extension:|moz-extension:)/i,
  });

  // 5. Mark as dismissed BEFORE showing — ensures the modal never re-appears
  //    even if the user navigates away without clicking "Got it".
  //    If this write fails (e.g. extension context invalidated), skip showing
  //    the modal entirely; it will be shown on the next load with a valid context.
  try {
    await chrome.storage.local.set({
      [StorageKeys.CHANGELOG_DISMISSED_VERSION]: EXTENSION_VERSION,
    });
  } catch {
    return null;
  }

  // 6. Inject modal
  const readGateSeconds =
    applyReadGate && FORCE_POPUP_VERSIONS.has(version) ? FORCE_POPUP_READ_GATE_SECONDS : 0;
  // An auto-open says where to change how releases announce themselves.
  const overlay = await createChangelogModal(sanitizedHtml, lang, readGateSeconds, applyReadGate);
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Open the changelog modal for the current version (always shows, no dismiss
 * check). Manual opens from the prompt manager skip the read-gate countdown
 * since the user has already seen the auto-popup once.
 *
 * @returns whether the modal was actually shown — callers reacting to an
 * explicit user click should provide a fallback when this is false.
 */
export async function openChangelog(): Promise<boolean> {
  const overlay = await showChangelogModal(EXTENSION_VERSION, true, false);
  return overlay !== null;
}

/**
 * Check if the current version has an unread changelog.
 */
export async function hasUnreadChangelog(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(StorageKeys.CHANGELOG_DISMISSED_VERSION);
    const dismissed = result[StorageKeys.CHANGELOG_DISMISSED_VERSION] as string | undefined;
    if (!dismissed) return false;
    return dismissed !== EXTENSION_VERSION;
  } catch {
    return false;
  }
}

/**
 * Show the changelog modal directly (used by badge mode in prompt manager).
 * Returns a Promise that resolves when the modal is closed.
 */
export async function showChangelogModalDirect(): Promise<boolean> {
  // Badge-mode prompt-manager open: skip the read-gate. The user is
  // explicitly clicking the changelog button — they don't need a countdown.
  const overlay = await showChangelogModal(EXTENSION_VERSION, true, false);
  if (!overlay) {
    // No notes found for this version — dismiss anyway so badge doesn't persist
    try {
      await chrome.storage.local.set({
        [StorageKeys.CHANGELOG_DISMISSED_VERSION]: EXTENSION_VERSION,
      });
    } catch {
      // Ignore
    }
    return false;
  }

  // Resolve once the overlay is removed (modal closed)
  return new Promise<boolean>((resolve) => {
    const observer = new MutationObserver(() => {
      if (!overlay.isConnected) {
        observer.disconnect();
        resolve(true);
      }
    });
    observer.observe(document.body, { childList: true });
  });
}

/**
 * Start the changelog feature.
 * Shows a version-based changelog popup when the user upgrades to a new version.
 * Returns a cleanup function.
 */
export async function startChangelog(opts: { onClosed?: () => void } = {}): Promise<() => void> {
  let overlayRef: HTMLDivElement | null = null;

  // Debug helper: switch DevTools console context to this extension's content script
  // (dropdown next to "top" in the console), then call:
  //   __gvChangelog()          — show current version
  //   __gvChangelog('1.2.8')   — show specific version
  (window as unknown as Record<string, unknown>).__gvChangelog = (version?: string) => {
    showChangelogModal(version ?? EXTENSION_VERSION, true);
  };

  try {
    // Only popup mode opens the modal on its own: badge mode leaves it to the
    // floating ball, off mode to the Prompt Manager's version badge.
    // Exception: force-popup versions ignore this and surface the modal anyway.
    const notifyMode = await readNotifyMode();
    const isForcePopup = FORCE_POPUP_VERSIONS.has(EXTENSION_VERSION);
    if (notifyMode !== 'popup' && !isForcePopup) {
      return () => {};
    }

    overlayRef = await showChangelogModal();
    // Fire onClosed once the user dismisses the modal (overlay leaves the DOM).
    // Only when a modal actually showed — so downstream onboarding stays tied to
    // the "what's new" moment.
    if (overlayRef && opts.onClosed) {
      const node = overlayRef;
      const obs = new MutationObserver(() => {
        if (!node.isConnected) {
          obs.disconnect();
          try {
            opts.onClosed?.();
          } catch {
            /* non-critical */
          }
        }
      });
      obs.observe(document.body, { childList: true });
    }
  } catch {
    // Silently fail — changelog is non-critical
  }

  return () => {
    if (overlayRef) {
      closeChangelogModal(overlayRef);
      overlayRef = null;
    }
  };
}
