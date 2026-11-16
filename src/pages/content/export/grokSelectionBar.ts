/**
 * Grok-only placement for the export selection bar.
 *
 * The shared bar is `position: fixed; top: 12px`, which sits on Grok's
 * conversation title and on the first message under it. Grok already names
 * both landmarks (`export.title` and `scrollContainer` in site.json). When
 * this page is Grok, the bar is inserted after the title's block and before
 * the transcript, so it takes its own row instead of covering either.
 */

const GROK_PLATFORM = 'grok';
const TITLE_SELECTOR = '[data-testid="conversation-title"]';
const SCROLLER_SELECTOR = '[data-testid="chat-transcript-scroller"]';
const DOCKED_CLASS = 'gv-export-select-bar--docked';
/** Gap under a title we could not dock beneath. */
const TITLE_CLEARANCE_PX = 8;

function clearPin(bar: HTMLElement): void {
  bar.style.removeProperty('left');
  bar.style.removeProperty('right');
  bar.style.removeProperty('top');
  bar.style.removeProperty('transform');
}

/**
 * The title's block that does not contain the transcript: its parent does.
 * Inserting after that block puts the bar under the title and above the messages.
 */
function blockAboveTranscript(title: Element, scroller: Element): HTMLElement | null {
  let node: HTMLElement | null = title instanceof HTMLElement ? title : title.parentElement;
  while (node) {
    const parent = node.parentElement;
    if (!parent) return null;
    if (parent.contains(scroller) && !node.contains(scroller)) return node;
    if (node === document.body || node === document.documentElement) return null;
    node = parent;
  }
  return null;
}

/**
 * Move the selection bar under Grok's title. Returns a cleanup, or null when
 * this page is not Grok (the shared fixed bar stays where it is).
 */
export function dockGrokSelectionBar(bar: HTMLElement): (() => void) | null {
  if (document.documentElement.dataset.gvPlatform !== GROK_PLATFORM) return null;
  const title = document.querySelector(TITLE_SELECTOR);
  const scroller = document.querySelector(SCROLLER_SELECTOR);
  if (title && scroller) {
    const header = blockAboveTranscript(title, scroller);
    const parent = header?.parentElement;
    if (header && parent) {
      parent.insertBefore(bar, header.nextSibling);
      bar.classList.add(DOCKED_CLASS);
      clearPin(bar);
      return () => {
        bar.classList.remove(DOCKED_CLASS);
      };
    }
  }
  if (!title) return null;
  const bottom = title.getBoundingClientRect().bottom;
  if (bottom <= 0) return null;
  bar.style.top = `${Math.round(bottom + TITLE_CLEARANCE_PX)}px`;
  return () => {
    bar.style.removeProperty('top');
  };
}
