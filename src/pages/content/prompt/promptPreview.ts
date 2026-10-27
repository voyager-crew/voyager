/**
 * The hover preview for Prompt Manager rows: the full prompt, rendered as
 * Markdown, in a card beside the panel.
 *
 * Opens ~250 ms after the pointer enters a row and closes ~150 ms after it
 * leaves - long enough to cross the gap onto the card, where long prompts can
 * be read and scrolled. Entering the card cancels a pending hide; leaving it
 * schedules one. One card is reused for every row, and scrolling the list or
 * the page dismisses it so it never hangs over rows that moved away. Rows the
 * pointer crosses on its way to the card wait (see `safeTriangle.ts`).
 */
import { highlightTemplateVariables } from './PromptTemplateFill';
import { renderPromptMarkdown } from './promptMarkdownLoader';
import { createAimedRows } from './safeTriangle';

const OPEN_DELAY_MS = 250;
const HIDE_GRACE_MS = 150;
const VISIBLE_CLASS = 'gv-pm-tooltip-visible';

export interface PromptPreview {
  /** Shows `text` while the pointer rests on `target`; a press on `target` dismisses it. */
  attach: (target: HTMLElement, text: string) => void;
  /** Dismisses at once, cancelling a pending open. */
  hide: () => void;
  /** Hides, removes the card and stops listening for scrolls. */
  destroy: () => void;
}

export interface PromptPreviewOptions {
  /** The card sits beside this panel and takes its `data-gv-theme`. */
  panel: HTMLElement;
  /** Scrolling this element (or the page) dismisses the card. */
  scrollRoot: HTMLElement;
}

export function createPromptPreview({ panel, scrollRoot }: PromptPreviewOptions): PromptPreview {
  let card: HTMLDivElement | null = null;
  let cardBody: HTMLDivElement | null = null;
  /* Bumped on every open and every hide. A Markdown render started for one
   * row must not paint into the preview after the pointer has moved to a
   * different row, or after the preview has already been dismissed. */
  let renderToken = 0;
  let openTimer: number | null = null;
  let hideTimer: number | null = null;
  let targetHovered = false;
  let cardHovered = false;
  /** The row the card last showed. */
  let shownTarget: HTMLElement | null = null;

  // The diagonal to the card crosses other rows. Entering one started its open
  // timer and leaving it before the timer fired hid the card mid-way.
  const rows = createAimedRows({
    card: () => (card?.classList.contains(VISIBLE_CLASS) ? card : null),
    owner: () => shownTarget,
    // The card and the stalled-aim resume decide when it closes, not a leave
    // that arrived just before the aim began.
    onAim: clearHideTimer,
  });

  function clearOpenTimer(): void {
    if (openTimer !== null) {
      window.clearTimeout(openTimer);
      openTimer = null;
    }
  }

  function clearHideTimer(): void {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function hide(): void {
    clearOpenTimer();
    clearHideTimer();
    rows.stop();
    renderToken += 1;
    targetHovered = false;
    cardHovered = false;
    if (card) {
      card.classList.remove(VISIBLE_CLASS);
    }
  }

  function scheduleHide(): void {
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      if (!cardHovered && !targetHovered) {
        hide();
      }
    }, HIDE_GRACE_MS);
  }

  function ensureCard(): HTMLDivElement {
    if (card) return card;
    const el = document.createElement('div');
    el.className = 'gv-pm-tooltip';
    el.setAttribute('role', 'tooltip');
    // Entering the tooltip cancels any pending hide; leaving schedules it.
    // This is what lets the user glide from row → gap → tooltip and scroll.
    el.addEventListener('mouseenter', () => {
      cardHovered = true;
      clearHideTimer();
    });
    el.addEventListener('mouseleave', () => {
      cardHovered = false;
      scheduleHide();
    });
    // macOS hides overlay scrollbars until a scroll begins, so a clipped card
    // simply stopped mid-sentence and read as broken rather than scrollable.
    el.addEventListener('scroll', () => markOverflow(el), { passive: true });
    // Content lives in an inner .gv-md so the rendered Markdown is styled by
    // the same rules as the comfortable-mode list item, while the outer
    // element keeps the surface, scrolling and positioning.
    const body = document.createElement('div');
    body.className = 'gv-md';
    el.appendChild(body);
    document.body.appendChild(el);
    card = el;
    cardBody = body;
    return el;
  }

  // Position: beside the panel, aligned to the row. Measurement requires the
  // element to be laid out, so reveal first then adjust; CSS keeps it
  // invisible until the `-visible` class is applied. Called again once
  // Markdown lands, because rendering changes the height.
  function position(target: HTMLElement): void {
    const el = card;
    if (!el) return;
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.visibility = 'hidden';
    el.classList.add(VISIBLE_CLASS);
    const targetRect = target.getBoundingClientRect();
    const tipRect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;

    const panelRect = panel.getBoundingClientRect();
    const gap = 10;

    // Beside the panel, never over it. The preview explains one row, and
    // starting it at that row's own left edge laid the card across the list -
    // hiding both the row it belongs to and every row the pointer was about
    // to travel to. Prefer the side with room; fall back to the roomier edge
    // of the viewport only when neither side fits.
    const roomRight = vw - panelRect.right - gap - pad;
    const roomLeft = panelRect.left - gap - pad;
    let left: number;
    if (roomRight >= tipRect.width) left = panelRect.right + gap;
    else if (roomLeft >= tipRect.width) left = panelRect.left - gap - tipRect.width;
    else left = roomRight >= roomLeft ? vw - pad - tipRect.width : pad;

    // Aligned to the row, then clamped into the viewport. Flipping between
    // above and below made the card jump the moment a row near the middle of
    // the list stopped fitting above it; sliding it keeps the card still
    // while the pointer moves down the list.
    let top = targetRect.top;
    if (top + tipRect.height > vh - pad) top = vh - pad - tipRect.height;
    if (top < pad) top = pad;

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.visibility = '';
    // Only measurable once the card has its final size.
    markOverflow(el);
  }

  function show(target: HTMLElement, fullText: string): void {
    const el = ensureCard();
    const body = cardBody;
    if (!body) return;
    // Reset scroll so each open starts at the top of the content.
    el.scrollTop = 0;
    // Show the raw text immediately so the peek stays instant on the first
    // hover, when marked + KaTeX are still being fetched. The Markdown pass
    // below replaces it; if the import fails, this stays as the fallback.
    body.textContent = fullText;
    body.classList.add('gv-pm-tooltip-raw');
    el.setAttribute('data-gv-theme', panel.getAttribute('data-gv-theme') || '');
    shownTarget = target;
    position(target);

    const token = ++renderToken;
    void renderPromptMarkdown(fullText)
      .then((html) => {
        // Stale render: the pointer moved to another row, or the preview was
        // dismissed while marked was loading.
        if (token !== renderToken || !card) return;
        body.innerHTML = html;
        openLinksInNewTab(body);
        body.classList.remove('gv-pm-tooltip-raw');
        highlightTemplateVariables(body);
        position(target);
      })
      .catch(() => {
        // Keep the plain-text fallback already on screen.
      });
  }

  function attach(target: HTMLElement, fullText: string): void {
    const enter = (): void => {
      targetHovered = true;
      clearHideTimer();
      clearOpenTimer();
      openTimer = window.setTimeout(() => {
        openTimer = null;
        if (targetHovered) show(target, fullText);
      }, OPEN_DELAY_MS);
    };
    const leave = (): void => {
      targetHovered = false;
      // Cancel a pending open (user left before it showed) — otherwise give
      // them the grace window to cross onto the tooltip.
      if (openTimer !== null) {
        clearOpenTimer();
        hide();
        return;
      }
      scheduleHide();
    };
    rows.bind(target, enter, leave);
    // A click/press activates the prompt; dismiss the hover preview immediately.
    target.addEventListener('mousedown', hide);
  }

  // Dismiss on scroll so the card never ends up orphaned when the list
  // scrolls under it. Exception: scrolling *inside* the card itself (long
  // prompts paginate within max-height) must keep it open — otherwise the
  // interactive preview is useless.
  const scrollTargets: Array<HTMLElement | Window> = [scrollRoot, window];
  const onScroll = (ev: Event) => {
    const t = ev.target as Node | null;
    if (card && t && (t === card || card.contains(t))) return;
    hide();
  };
  for (const target of scrollTargets) {
    target.addEventListener('scroll', onScroll, { passive: true, capture: true });
  }

  return {
    attach,
    hide,
    destroy: () => {
      hide();
      if (card) {
        try {
          card.remove();
        } catch {}
        card = null;
        cardBody = null;
      }
      for (const target of scrollTargets) {
        try {
          target.removeEventListener('scroll', onScroll, { capture: true });
        } catch {}
      }
    },
  };
}

/** Flags "there is more below" so the surface can show it. */
function markOverflow(el: HTMLElement): void {
  const more = el.scrollHeight - el.scrollTop - el.clientHeight > 1;
  el.classList.toggle('gv-pm-tooltip-more', more);
}

/**
 * This preview hangs over a live conversation. A Markdown link rendered into
 * it is an ordinary same-tab anchor, so following one navigated the host page
 * away and took an in-progress chat with it. Every other outbound link in the
 * Prompt Manager opens in a new tab; the preview has to match.
 */
function openLinksInNewTab(root: HTMLElement): void {
  for (const link of root.querySelectorAll('a[href]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
}
