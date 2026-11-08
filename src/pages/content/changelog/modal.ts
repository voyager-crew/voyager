import { createXIcon } from '@/core/icons/folderIcons';
import { createHeartIcon } from '@/core/icons/promptManagerIcons';
import { getWebStoreRatingChannel, isMac } from '@/core/utils/browser';
import { EXTENSION_VERSION } from '@/core/utils/version';
import type { AppLanguage } from '@/utils/language';
import { type TranslationKey, getLoadedTranslations, loadTranslations } from '@/utils/translations';

import { createChangelogFollowArea } from './changelogFollowArea';
import { renderChangelogMarks } from './changelogMarks';
import { renderPlatformLogoMarks } from './platformLogoMarks';

/** How each open viewer closes, so the feature's teardown runs the same cleanup as a click. */
const closers = new WeakMap<HTMLElement, () => void>();

/** Close a viewer from outside it (the feature stopping), releasing what it holds. */
export function closeChangelogModal(overlay: HTMLElement): void {
  const close = closers.get(overlay);
  if (close) close();
  else overlay.remove();
}

/**
 * Translate a key using an explicit language, bypassing cachedLanguage.
 * This avoids race conditions when initI18n() hasn't finished yet.
 */
function t(key: TranslationKey, lang: AppLanguage): string {
  return getLoadedTranslations(lang)?.[key] ?? getLoadedTranslations('en')?.[key] ?? key;
}

/**
 * Get the docs URL for the current language.
 * zh is the root locale (no prefix), others use /{locale}/ prefix.
 */
function getDocsUrl(lang: AppLanguage): string {
  const base = 'https://voyager.nagi.fun';
  const path = '/guide/getting-started';
  if (lang === 'zh') return `${base}${path}`;
  return `${base}/${lang}${path}`;
}

/**
 * Get the sponsor page URL for the current language.
 * zh is the root locale (no prefix), others use /{locale}/ prefix.
 */
function getSponsorUrl(lang: AppLanguage): string {
  const base = 'https://voyager.nagi.fun';
  const path = '/guide/sponsor.html';
  if (lang === 'zh') return `${base}${path}`;
  return `${base}/${lang}${path}`;
}

/**
 * Show a full-screen lightbox preview for the given image.
 */
function showImageLightbox(src: string, alt: string): void {
  const lightbox = document.createElement('div');
  lightbox.className = 'gv-changelog-lightbox';

  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.className = 'gv-changelog-lightbox-img';

  lightbox.appendChild(img);
  document.body.appendChild(lightbox);

  const close = (): void => {
    lightbox.remove();
    document.removeEventListener('keydown', onKeyDown);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  lightbox.addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown);
}

const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/gemini-voyager/iifacdnjakkhjjiengaffnegbndgingi';
const EDGE_STORE_URL =
  'https://microsoftedge.microsoft.com/addons/detail/voyager/gibmkggjijalcjinbdhcpklodjkhhlne';

/**
 * Render the changelog modal DOM.
 */
export async function createChangelogModal(
  htmlContent: string,
  lang: AppLanguage,
  readGateSeconds: number = 0,
  showNotifyHint: boolean = false,
): Promise<HTMLDivElement> {
  await loadTranslations(lang);
  const overlay = document.createElement('div');
  overlay.className = 'gv-changelog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'gv-changelog-dialog';

  // Header
  const header = document.createElement('div');
  header.className = 'gv-changelog-header';

  const title = document.createElement('span');
  title.className = 'gv-changelog-title';
  title.textContent = t('changelog_title', lang);

  const version = document.createElement('span');
  version.className = 'gv-changelog-version';
  version.textContent = `v${EXTENSION_VERSION}`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'gv-changelog-close';
  closeBtn.appendChild(createXIcon(16));
  closeBtn.setAttribute('aria-label', t('commonClose', lang));

  header.appendChild(title);
  header.appendChild(version);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'gv-changelog-body';
  body.innerHTML = htmlContent;
  renderPlatformLogoMarks(body);
  const disposeMarks = renderChangelogMarks(body, {
    mac: isMac(),
    lang,
    switchHint: t('changelog_switch_hint', lang),
  });
  const leadingElement = body.firstElementChild;
  if (leadingElement?.tagName === 'BLOCKQUOTE') {
    leadingElement.classList.add('gv-changelog-quote');
  }

  // Bind image zoom on all images in the body
  body.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    img.addEventListener('click', () => showImageLightbox(img.src, img.alt));
  });

  // Footer
  const footer = document.createElement('div');
  footer.className = 'gv-changelog-footer';

  const followArea = createChangelogFollowArea(t('changelog_follow_cta', lang));

  // Action row: icons on the left, "Got it" button on the right
  const actionRow = document.createElement('div');
  actionRow.className = 'gv-changelog-action-row';

  const iconGroup = document.createElement('div');
  iconGroup.className = 'gv-changelog-icon-group';

  // Sponsor (heart) link
  const sponsorLink = document.createElement('a');
  sponsorLink.className = 'gv-changelog-icon-link gv-changelog-icon-sponsor';
  sponsorLink.href = getSponsorUrl(lang);
  sponsorLink.target = '_blank';
  sponsorLink.rel = 'noopener noreferrer';
  sponsorLink.setAttribute('aria-label', t('sponsorMe', lang));
  sponsorLink.appendChild(createHeartIcon(18));

  // GitHub link
  const githubLink = document.createElement('a');
  githubLink.className = 'gv-changelog-icon-link gv-changelog-icon-github';
  githubLink.href = 'https://github.com/voyager-crew/voyager';
  githubLink.target = '_blank';
  githubLink.rel = 'noopener noreferrer';
  githubLink.setAttribute('aria-label', 'GitHub');
  githubLink.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>';

  // Docs link with annotation
  // (X/Twitter icon is intentionally omitted from this bottom row — it
  // already appears as a chip in the follow-me CTA card above, so a
  // duplicate would just visually crowd the action row.)
  const docsWrapper = document.createElement('div');
  docsWrapper.className = 'gv-changelog-docs-wrapper';

  const docsAnnotation = document.createElement('span');
  docsAnnotation.className = 'gv-changelog-docs-annotation';
  docsAnnotation.textContent = t('changelog_docs_hint', lang);

  const docsLink = document.createElement('a');
  docsLink.className = 'gv-changelog-icon-link gv-changelog-icon-docs';
  docsLink.href = getDocsUrl(lang);
  docsLink.target = '_blank';
  docsLink.rel = 'noopener noreferrer';
  docsLink.setAttribute('aria-label', t('changelog_docs_link', lang));
  // Open-book icon
  docsLink.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/></svg>';

  docsWrapper.appendChild(docsAnnotation);
  docsWrapper.appendChild(docsLink);

  iconGroup.appendChild(sponsorLink);
  iconGroup.appendChild(githubLink);
  iconGroup.appendChild(docsWrapper);

  const gotItBtn = document.createElement('button');
  gotItBtn.className = 'gv-changelog-got-it';
  gotItBtn.textContent = t('changelog_close', lang);

  actionRow.appendChild(iconGroup);
  actionRow.appendChild(gotItBtn);

  // The notification-mode choice lives in General Options in the extension
  // settings (StorageKeys.CHANGELOG_NOTIFY_MODE); an auto-opened modal only
  // points there.

  footer.appendChild(followArea);

  // Web store rating prompt (Chrome Web Store / Edge Add-ons).
  // Temporarily hidden — keep the code so we can re-enable it later by flipping
  // this flag back to true.
  const SHOW_STORE_RATING = false;
  const webStoreRatingChannel = getWebStoreRatingChannel();
  const storeRating: {
    url: string;
    textKey: TranslationKey;
    ctaKey: TranslationKey;
  } | null =
    webStoreRatingChannel === 'edge'
      ? { url: EDGE_STORE_URL, textKey: 'changelog_rate_edge', ctaKey: 'changelog_rate_edge_cta' }
      : webStoreRatingChannel === 'chrome'
        ? {
            url: CHROME_STORE_URL,
            textKey: 'changelog_rate_chrome',
            ctaKey: 'changelog_rate_chrome_cta',
          }
        : null;
  if (storeRating && SHOW_STORE_RATING) {
    const ratingBanner = document.createElement('div');
    ratingBanner.className = 'gv-changelog-chrome-rating';

    const ratingText = document.createElement('span');
    ratingText.className = 'gv-changelog-chrome-rating-text';
    ratingText.textContent = t(storeRating.textKey, lang);

    const ratingLink = document.createElement('a');
    ratingLink.className = 'gv-changelog-chrome-rating-link';
    ratingLink.href = storeRating.url;
    ratingLink.target = '_blank';
    ratingLink.rel = 'noopener noreferrer';
    const ratingStar = document.createElement('span');
    ratingStar.className = 'gv-changelog-chrome-rating-star';
    ratingStar.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
    const ratingCtaText = document.createElement('span');
    ratingCtaText.textContent = t(storeRating.ctaKey, lang);
    ratingLink.appendChild(ratingStar);
    ratingLink.appendChild(ratingCtaText);

    ratingBanner.appendChild(ratingText);
    ratingBanner.appendChild(ratingLink);
    footer.appendChild(ratingBanner);
  }

  footer.appendChild(actionRow);

  if (showNotifyHint) {
    const notifyHint = document.createElement('p');
    notifyHint.className = 'gv-changelog-notify-hint';
    notifyHint.textContent = t('changelog_notify_mode_footer_hint', lang);
    footer.appendChild(notifyHint);
  }

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);

  // Read-gate countdown: for force-popup releases we briefly disable the
  // close controls (× / Got-it button / outside-click) and show the remaining
  // seconds on the Got-it button. This makes sure users actually see the
  // notes for major releases instead of dismissing reflexively.
  let readyToClose = readGateSeconds <= 0;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  const gotItLabel = t('changelog_close', lang);

  const setGated = (remaining: number) => {
    closeBtn.disabled = true;
    closeBtn.classList.add('gv-changelog-close--gated');
    gotItBtn.disabled = true;
    gotItBtn.classList.add('gv-changelog-got-it--gated');
    gotItBtn.textContent = `${gotItLabel} (${remaining})`;
  };

  const releaseGate = () => {
    readyToClose = true;
    closeBtn.disabled = false;
    closeBtn.classList.remove('gv-changelog-close--gated');
    gotItBtn.disabled = false;
    gotItBtn.classList.remove('gv-changelog-got-it--gated');
    gotItBtn.textContent = gotItLabel;
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  };

  if (!readyToClose) {
    let remaining = readGateSeconds;
    setGated(remaining);
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        releaseGate();
      } else {
        setGated(remaining);
      }
    }, 1000);
  }

  const onClose = (): void => {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    disposeMarks();
    closers.delete(overlay);
    overlay.remove();
  };
  closers.set(overlay, onClose);

  closeBtn.addEventListener('click', () => {
    if (!readyToClose) return;
    onClose();
  });
  gotItBtn.addEventListener('click', () => {
    if (!readyToClose) return;
    onClose();
  });
  // Force-popup releases require an explicit click on × or the Got-it
  // button to dismiss — outside-click never closes the modal, even after
  // the countdown finishes. Regular releases keep the click-outside-to-
  // dismiss convenience.
  const lockOutsideClick = readGateSeconds > 0;
  overlay.addEventListener('click', (e) => {
    if (lockOutsideClick) return;
    if (e.target === overlay && readyToClose) {
      onClose();
    }
  });

  return overlay;
}
