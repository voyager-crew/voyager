import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { WATERMARK_STORAGE_KEYS, resolveWatermarkSettings } from '@/core/utils/watermarkSettings';
import { packagedPluginRunsHere } from '@/features/plugins/runtime/packagedFormFactor';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { getCurrentLanguage } from '@/utils/i18n';
import type { AppLanguage } from '@/utils/language';
import { type TranslationKey, getLoadedTranslations, loadTranslations } from '@/utils/translations';

import { hasCleanImageStreak } from './cleanStreak';

/**
 * One-time notice announcing that Gemini itself can now hide the visible
 * "media watermark", which makes Voyager's watermark removal redundant.
 *
 * Google started rolling the switch out on 2026-08-14 and it arrives
 * gradually; work/school accounts and some regions never get it. So the
 * notice never flips the user's settings on its own — it explains where the
 * native switch lives and offers a button the user presses *after* they have
 * turned it off themselves.
 */

export const WATERMARK_NATIVE_NOTICE_DELAY_MS = 3 * 1000;

const NOTICE_CLASS = 'gv-wm-notice';
const STEPS_IMAGE_PATH = 'watermark-native-steps.png';
const DONE_AUTOCLOSE_MS = 1600;

let noticeTimer: number | null = null;
let cleanupActiveNotice: (() => void) | null = null;
let started = false;
let runId = 0;

function t(key: TranslationKey, lang: AppLanguage): string {
  return getLoadedTranslations(lang)?.[key] ?? getLoadedTranslations('en')?.[key] ?? key;
}

async function loadNoticeLanguage(): Promise<AppLanguage> {
  const language = await getCurrentLanguage();
  try {
    await loadTranslations(language);
    return language;
  } catch (error) {
    // This notice still needs to reach eligible users when a locale chunk is unavailable.
    logger.warn('Could not load native watermark notice language', {
      language,
      error: String(error),
    });
    return 'en';
  }
}

function getLocalStorage(defaults: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(defaults, (result) => {
        resolve(result ?? defaults);
      });
    } catch {
      resolve(defaults);
    }
  });
}

function setLocalStorage(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(values, () => resolve());
    } catch {
      resolve();
    }
  });
}

function getRuntimeUrl(path: string): string | null {
  try {
    const scope = globalThis as typeof globalThis & {
      browser?: { runtime?: { getURL?: (assetPath: string) => string } };
      chrome?: { runtime?: { getURL?: (assetPath: string) => string } };
    };
    const getUrl = scope.browser?.runtime?.getURL ?? scope.chrome?.runtime?.getURL;
    return typeof getUrl === 'function' ? getUrl(path) : null;
  } catch {
    return null;
  }
}

export interface WatermarkNativeNoticeState {
  /** The user has already seen (and dismissed) this notice. */
  alreadyShown: boolean;
  /** At least one of Voyager's watermark-removal paths is still enabled. */
  removalActive: boolean;
}

/**
 * Users who already turned Voyager's removal off have nothing to act on, so
 * they are never interrupted. Everyone else sees the notice exactly once.
 */
export function shouldShowWatermarkNativeNotice(state: WatermarkNativeNoticeState): boolean {
  if (state.alreadyShown) return false;
  return state.removalActive;
}

async function markNoticeShown(): Promise<void> {
  await setLocalStorage({ [StorageKeys.WATERMARK_NATIVE_NOTICE_SHOWN]: true });
}

async function disableWatermarkRemoval(): Promise<boolean> {
  // Only the two current keys are written. The legacy single key is left
  // untouched on purpose: resolveWatermarkSettings gives the new keys
  // precedence, so this is enough to turn both paths off without rewriting
  // settings the user may still rely on if they downgrade.
  try {
    await chrome.storage.sync.set({
      [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: false,
      [StorageKeys.WATERMARK_PREVIEW_ENABLED]: false,
    });
    return true;
  } catch {
    return false;
  }
}

function removeExistingNotice(): void {
  document.querySelector(`.${NOTICE_CLASS}`)?.remove();
  cleanupActiveNotice = null;
}

/**
 * The screenshot already carries numbered markers, so repeating the three
 * steps as prose would say the same thing twice. This renders the path as a
 * single breadcrumb line instead, with each hop as its own chip.
 */
function buildPathTrail(lang: AppLanguage): HTMLParagraphElement {
  const trail = document.createElement('p');
  trail.className = `${NOTICE_CLASS}__trail`;

  const raw = t('watermarkNotice_path', lang);
  // Locales use the arrow that matches their direction; split on either.
  const hops = raw
    .split(/\s*[→←]\s*/)
    .map((hop) => hop.trim())
    .filter(Boolean);

  hops.forEach((hop, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = `${NOTICE_CLASS}__trail-sep`;
      sep.setAttribute('aria-hidden', 'true');
      trail.appendChild(sep);
    }
    const chip = document.createElement('span');
    chip.className = `${NOTICE_CLASS}__trail-hop`;
    // The last hop is the value the user must land on, so it reads as the
    // destination rather than another waypoint.
    if (index === hops.length - 1) chip.classList.add(`${NOTICE_CLASS}__trail-hop--target`);
    chip.textContent = hop;
    trail.appendChild(chip);
  });

  return trail;
}

function mountNotice(lang: AppLanguage, detectedClean: boolean, onSettled: () => void): void {
  if (document.querySelector(`.${NOTICE_CLASS}`)) return;

  const overlay = document.createElement('div');
  overlay.className = NOTICE_CLASS;
  overlay.setAttribute('role', 'presentation');

  const dialog = document.createElement('div');
  dialog.className = `${NOTICE_CLASS}__dialog`;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-labelledby', 'gv-wm-notice-title');

  const header = document.createElement('div');
  header.className = `${NOTICE_CLASS}__header`;

  const title = document.createElement('h2');
  title.id = 'gv-wm-notice-title';
  title.className = `${NOTICE_CLASS}__title`;
  title.textContent = t('watermarkNotice_title', lang);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = `${NOTICE_CLASS}__close`;
  closeBtn.setAttribute('aria-label', t('watermarkNotice_keepCta', lang));
  closeBtn.textContent = '✕';

  const heading = document.createElement('div');
  heading.className = `${NOTICE_CLASS}__heading`;
  heading.appendChild(title);

  // The clean-image observation is supporting evidence for the title, not a
  // paragraph of its own — it rides along as a pill under the headline.
  if (detectedClean) {
    const detected = document.createElement('span');
    detected.className = `${NOTICE_CLASS}__detected`;
    detected.textContent = t('watermarkNotice_detected', lang);
    heading.appendChild(detected);
  }

  header.appendChild(heading);
  header.appendChild(closeBtn);

  // Hero: the screenshot is the instruction, so it runs edge to edge directly
  // under the headline instead of sitting inside the prose.
  const stepsImageUrl = getRuntimeUrl(STEPS_IMAGE_PATH);
  let hero: HTMLElement | null = null;
  if (stepsImageUrl) {
    hero = document.createElement('figure');
    hero.className = `${NOTICE_CLASS}__hero`;

    const figure = document.createElement('img');
    figure.className = `${NOTICE_CLASS}__image`;
    figure.src = stepsImageUrl;
    figure.alt = t('watermarkNotice_imageAlt', lang);
    figure.loading = 'lazy';
    hero.appendChild(figure);

    const caption = document.createElement('figcaption');
    caption.className = `${NOTICE_CLASS}__hero-caption`;
    caption.appendChild(buildPathTrail(lang));
    hero.appendChild(caption);
  }

  const body = document.createElement('div');
  body.className = `${NOTICE_CLASS}__body`;

  const bodyText = document.createElement('p');
  bodyText.className = `${NOTICE_CLASS}__lead`;
  bodyText.textContent = t('watermarkNotice_body', lang);
  body.appendChild(bodyText);

  // No hero means no numbered screenshot to lean on, so the path has to carry
  // the instruction by itself.
  if (!hero) body.appendChild(buildPathTrail(lang));

  const actions = document.createElement('div');
  actions.className = `${NOTICE_CLASS}__actions`;

  const caveat = document.createElement('p');
  caveat.className = `${NOTICE_CLASS}__caveat`;
  caveat.textContent = t('watermarkNotice_caveat', lang);
  actions.appendChild(caveat);

  const buttonRow = document.createElement('div');
  buttonRow.className = `${NOTICE_CLASS}__buttons`;

  const keepBtn = document.createElement('button');
  keepBtn.type = 'button';
  keepBtn.className = `${NOTICE_CLASS}__btn ${NOTICE_CLASS}__btn--secondary`;
  keepBtn.textContent = t('watermarkNotice_keepCta', lang);

  const disableBtn = document.createElement('button');
  disableBtn.type = 'button';
  disableBtn.className = `${NOTICE_CLASS}__btn ${NOTICE_CLASS}__btn--primary`;
  disableBtn.textContent = t('watermarkNotice_disableCta', lang);

  buttonRow.appendChild(disableBtn);
  buttonRow.appendChild(keepBtn);
  actions.appendChild(buttonRow);

  dialog.appendChild(header);
  if (hero) dialog.appendChild(hero);
  dialog.appendChild(body);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  let doneTimer: number | null = null;

  function teardown(): void {
    if (doneTimer !== null) {
      clearTimeout(doneTimer);
      doneTimer = null;
    }
    dialog.removeEventListener('keydown', onKeyDown);
    removeExistingNotice();
  }

  function close(): void {
    void markNoticeShown();
    teardown();
    onSettled();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    // This is a non-modal helper. Only consume Escape while focus is inside
    // the card, otherwise Gemini should remain in control of its own menus.
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  closeBtn.addEventListener('click', close);
  keepBtn.addEventListener('click', close);

  disableBtn.addEventListener('click', () => {
    disableBtn.disabled = true;
    keepBtn.disabled = true;
    actions.querySelector(`.${NOTICE_CLASS}__error`)?.remove();
    void disableWatermarkRemoval().then((disabled) => {
      if (!disabled) {
        disableBtn.disabled = false;
        keepBtn.disabled = false;
        const error = document.createElement('p');
        error.className = `${NOTICE_CLASS}__error`;
        error.setAttribute('role', 'alert');
        error.textContent = t('watermarkNotice_error', lang);
        actions.insertBefore(error, buttonRow);
        return;
      }

      void markNoticeShown();
      // Confirm in place rather than closing instantly — the user just changed
      // a setting and should see where it can be undone.
      actions.replaceChildren();
      const done = document.createElement('p');
      done.className = `${NOTICE_CLASS}__done`;
      done.setAttribute('role', 'status');
      done.textContent = t('watermarkNotice_done', lang);
      actions.appendChild(done);
      doneTimer = window.setTimeout(() => {
        teardown();
        onSettled();
      }, DONE_AUTOCLOSE_MS);
    });
  });

  // The surrounding layer is click-through, so the user can keep this guide
  // visible while opening Gemini's settings. Escape is scoped to the card for
  // the same reason: interacting with Gemini must not dismiss the notice.
  dialog.addEventListener('keydown', onKeyDown);

  cleanupActiveNotice = () => {
    teardown();
  };
}

/** Whether a packaged plugin runs on this device; the removal plugins do not on a phone. */
type RunsHere = (pluginId: string) => Promise<boolean>;

async function scheduleNotice(
  delayMs: number,
  currentRunId: number,
  onSettled: () => void,
  runsHere: RunsHere,
): Promise<void> {
  const localDefaults = {
    [StorageKeys.WATERMARK_NATIVE_NOTICE_SHOWN]: false,
    [StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]: 0,
  };
  const stored = await getLocalStorage(localDefaults);
  if (currentRunId !== runId) return;
  if (stored[StorageKeys.WATERMARK_NATIVE_NOTICE_SHOWN] === true) {
    onSettled();
    return;
  }

  let settings;
  try {
    const record = await chrome.storage?.sync?.get([...WATERMARK_STORAGE_KEYS]);
    settings = resolveWatermarkSettings(record ?? null);
  } catch {
    onSettled();
    return;
  }
  // A switch on for a removal plugin this device never runs removes nothing here.
  const removalActive =
    (settings.download && (await runsHere(OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload))) ||
    (settings.preview && (await runsHere(OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview)));
  if (currentRunId !== runId) return;

  const shouldShow = shouldShowWatermarkNativeNotice({
    alreadyShown: stored[StorageKeys.WATERMARK_NATIVE_NOTICE_SHOWN] === true,
    removalActive,
  });
  if (!shouldShow) {
    onSettled();
    return;
  }

  const detectedClean = hasCleanImageStreak(stored[StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]);
  const lang = await loadNoticeLanguage();
  if (currentRunId !== runId) return;

  noticeTimer = window.setTimeout(async () => {
    if (currentRunId !== runId) return;
    const latest = await getLocalStorage(localDefaults);
    if (currentRunId !== runId) return;
    if (latest[StorageKeys.WATERMARK_NATIVE_NOTICE_SHOWN] === true) {
      onSettled();
      return;
    }
    mountNotice(lang, detectedClean, onSettled);
  }, delayMs);
}

export interface WatermarkNativeNoticeOptions {
  delayMs?: number;
  onSettled?: () => void;
  /** Test seam; defaults to the packaged plugins' own form factors. */
  runsHere?: RunsHere;
}

/**
 * Start the one-time native-watermark notice. Returns a cleanup function.
 * Safari supports watermark removal too; skipping it would hide the notice from eligible users.
 */
export function startWatermarkNativeNotice(
  options: number | WatermarkNativeNoticeOptions = {},
): () => void {
  const { delayMs, onSettled, runsHere } =
    typeof options === 'number'
      ? { delayMs: options, onSettled: undefined, runsHere: packagedPluginRunsHere }
      : {
          delayMs: options.delayMs ?? WATERMARK_NATIVE_NOTICE_DELAY_MS,
          onSettled: options.onSettled,
          runsHere: options.runsHere ?? packagedPluginRunsHere,
        };
  let settled = false;
  const settleOnce = () => {
    if (settled) return;
    settled = true;
    onSettled?.();
  };

  if (started) {
    settleOnce();
    return () => {};
  }
  started = true;
  const currentRunId = runId + 1;
  runId = currentRunId;

  // Debug helper: switch the DevTools console context to this content script
  // and call __gvWatermarkNotice() to force the dialog open.
  (window as unknown as Record<string, unknown>).__gvWatermarkNotice = async () => {
    const lang = await loadNoticeLanguage();
    removeExistingNotice();
    mountNotice(lang, true, () => {});
  };

  void scheduleNotice(delayMs, currentRunId, settleOnce, runsHere).catch((error: unknown) => {
    if (currentRunId !== runId) return;
    logger.warn('Could not prepare native watermark notice', { error: String(error) });
    settleOnce();
  });

  return () => {
    started = false;
    runId += 1;
    if (noticeTimer !== null) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    cleanupActiveNotice?.();
    removeExistingNotice();
  };
}
