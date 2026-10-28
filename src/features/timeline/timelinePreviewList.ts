/**
 * The timeline preview's list rows: index, truncated summary with search
 * matches marked, and the starred/active state. DOM only; no panel state.
 */
import { getTranslationSync } from '@/utils/i18n';

import type { PreviewMarkerData } from './types';

const SUMMARY_MAX_LENGTH = 80;

export interface PreviewListView {
  markers: ReadonlyArray<PreviewMarkerData>;
  query: string;
  activeTurnId: string | null;
  onItemClick: (marker: PreviewMarkerData, event: MouseEvent) => void;
}

/** Replaces the list's rows, or shows the empty state for no messages or no matches. */
export function renderPreviewList(listEl: HTMLElement, view: PreviewListView): void {
  listEl.textContent = '';

  if (view.markers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'timeline-preview-empty';
    empty.textContent = view.query
      ? getTranslationSync('timelinePreviewNoResults')
      : getTranslationSync('timelinePreviewNoMessages');
    listEl.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const marker of view.markers) {
    fragment.appendChild(createItem(marker, view));
  }
  listEl.appendChild(fragment);
}

/** Wheel scrolling stays inside the list instead of scrolling the page at either end. */
export function isolateListScroll(listEl: HTMLElement): void {
  listEl.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.stopPropagation();
      const { scrollTop, scrollHeight, clientHeight } = listEl;
      const atTop = scrollTop <= 0 && e.deltaY < 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
      if (atTop || atBottom) {
        e.preventDefault();
      }
    },
    { passive: false },
  );
}

function createItem(marker: PreviewMarkerData, view: PreviewListView): HTMLElement {
  const item = document.createElement('div');
  item.className = 'timeline-preview-item';
  item.dataset.turnId = marker.id;

  if (marker.starred) {
    item.classList.add('starred');
  }
  if (marker.id === view.activeTurnId) {
    item.classList.add('active');
  }

  const indexLabel = document.createElement('span');
  indexLabel.className = 'timeline-preview-index';
  indexLabel.textContent = `${marker.index + 1}`;
  item.appendChild(indexLabel);

  const text = document.createElement('span');
  text.className = 'timeline-preview-text';
  text.setAttribute('dir', 'auto');
  const displayText = truncateText(marker.summary, SUMMARY_MAX_LENGTH);
  if (view.query) {
    appendHighlighted(text, displayText, view.query);
  } else {
    text.textContent = displayText;
  }
  item.appendChild(text);

  item.addEventListener('click', (event) => view.onItemClick(marker, event));

  return item;
}

/** Split text around case-insensitive query matches and wrap each match in <mark>. */
function appendHighlighted(container: HTMLElement, text: string, query: string): void {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let cursor = 0;
  let idx = lowerText.indexOf(lowerQuery, cursor);
  while (idx !== -1) {
    if (idx > cursor) {
      container.appendChild(document.createTextNode(text.slice(cursor, idx)));
    }
    const mark = document.createElement('mark');
    mark.className = 'timeline-preview-highlight';
    mark.textContent = text.slice(idx, idx + query.length);
    container.appendChild(mark);
    cursor = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) {
    container.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
