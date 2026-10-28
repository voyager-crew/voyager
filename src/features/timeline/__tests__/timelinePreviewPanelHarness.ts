/**
 * Shared fixtures for the TimelinePreviewPanel suites: the extension and i18n
 * mocks, marker data, and a panel mounted beside a timeline bar.
 */
import { vi } from 'vitest';

import { TimelinePreviewPanel } from '../TimelinePreviewPanel';
import type { PreviewMarkerData } from '../types';

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  getTranslationSync: (key: string) => {
    const map: Record<string, string> = {
      timelinePreviewSearch: 'Search...',
      timelinePreviewNoResults: 'No results',
      timelinePreviewNoMessages: 'No messages',
      timelineCompactOpenPreview: 'Open timeline preview',
    };
    return map[key] ?? key;
  },
}));

export function makeMarkers(count: number): PreviewMarkerData[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `turn-${i}`,
    summary: `User message number ${i + 1}`,
    index: i,
    starred: i === 2,
  }));
}

/** A fresh page holding a timeline bar with an initialized preview panel beside it. */
export function mountPreviewPanel(): {
  anchor: HTMLElement;
  panel: TimelinePreviewPanel;
  onNavigate: (turnId: string, index: number) => void;
} {
  document.body.innerHTML = '';
  document.body.className = '';
  const anchor = document.createElement('div');
  anchor.className = 'gemini-timeline-bar';
  document.body.appendChild(anchor);

  const onNavigate = vi.fn();
  const panel = new TimelinePreviewPanel(anchor);
  panel.init(onNavigate);
  return { anchor, panel, onNavigate };
}
