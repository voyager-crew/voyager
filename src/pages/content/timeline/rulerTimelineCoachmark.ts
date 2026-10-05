/** One-time guided intro for the compact ruler timeline. */
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { rulerWaveTick } from '@/features/timeline/denseMarkerLayout';
import {
  TIMELINE_STYLE_PREVIEW_ACTIVE_INDEX,
  type TimelineStylePreview,
  mountTimelineStylePreview,
} from '@/features/timeline/timelineStylePreview';
import { getTranslationSync, initI18n } from '@/utils/i18n';
import type { TranslationKey } from '@/utils/translations';

import {
  type CoachmarkProgress,
  type CoachmarkResult,
  type CoachmarkSequenceStep,
  showCoachmark,
} from '../coachmark';

export const RULER_TIMELINE_COACHMARK_ID = 'timeline-ruler-style-intro-v1';
export const RULER_TIMELINE_COACHMARK_DEBUG_EVENT = 'gv:debug:rulerTimelineCoachmark';

const RULER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5h5M5 8.5h9M5 12h13M5 15.5h9M5 19h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const t = (key: TranslationKey, fallback: string): string => {
  try {
    const value = getTranslationSync(key);
    return value && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
};

/** Ruler users need no intro, and node levels rule out the ruler the intro switches to. */
async function loadRulerIntroUnneeded(): Promise<boolean> {
  try {
    const got = (await browser.storage.sync.get({
      [StorageKeys.TIMELINE_STYLE]: 'dots',
      [StorageKeys.TIMELINE_MARKER_LEVEL]: false,
    })) as Record<string, unknown>;
    return (
      got[StorageKeys.TIMELINE_STYLE] === 'ruler' || got[StorageKeys.TIMELINE_MARKER_LEVEL] === true
    );
  } catch {
    return false;
  }
}

async function setRulerTimelineEnabled(on: boolean): Promise<void> {
  try {
    await browser.storage.sync.set({
      [StorageKeys.TIMELINE_STYLE]: on ? 'ruler' : 'dots',
    });
  } catch {
    /* non-critical */
  }
}

function buildRulerPreview(liveBar: HTMLElement | null): TimelineStylePreview {
  return mountTimelineStylePreview('is-ruler', liveBar, (tick, index) => {
    const { scale, opacity } = rulerWaveTick(Math.abs(index - TIMELINE_STYLE_PREVIEW_ACTIVE_INDEX));
    tick.style.setProperty('--gv-coach-ruler-scale', scale.toFixed(3));
    tick.style.setProperty('--gv-coach-ruler-opacity', opacity.toFixed(3));
  });
}

function setPreviewStyle(preview: HTMLElement | null, ruler: boolean): void {
  if (!preview) return;
  preview.classList.toggle('is-ruler', ruler);
  preview.classList.toggle('is-dots', !ruler);
}

export async function maybeShowRulerTimelineCoachmark(
  opts: { force?: boolean; progress?: CoachmarkProgress } = {},
): Promise<CoachmarkResult> {
  if (location.hostname !== 'gemini.google.com') return 'skipped';
  if (!opts.force && (await loadRulerIntroUnneeded())) return 'skipped';

  try {
    await initI18n();
  } catch {
    /* fall back to literals */
  }

  let preview: TimelineStylePreview | null = null;
  let hiddenTimelineElements: HTMLElement[] = [];

  return showCoachmark({
    id: RULER_TIMELINE_COACHMARK_ID,
    once: !opts.force,
    scrim: true,
    icon: RULER_ICON,
    title: t('timelineRulerCoachmarkTitle', 'New: ruler timeline'),
    body: t(
      'timelineRulerCoachmarkBody',
      'A compact signal follows your reading position. Hover any tick to instantly preview the question and response.',
    ),
    placement: 'top',
    reveal: {
      mount: () => {
        hiddenTimelineElements = Array.from(
          document.querySelectorAll<HTMLElement>('.gemini-timeline-bar, .timeline-left-slider'),
        );
        hiddenTimelineElements.forEach((element) =>
          element.classList.add('gv-coach-timeline-hidden'),
        );
        preview = buildRulerPreview(document.querySelector<HTMLElement>('.gemini-timeline-bar'));
        void setRulerTimelineEnabled(true);
        return preview.element;
      },
      unmount: (element) => {
        if (preview?.element === element) {
          preview.destroy();
          preview = null;
        }
        element?.remove();
        hiddenTimelineElements.forEach((timelineElement) =>
          timelineElement.classList.remove('gv-coach-timeline-hidden'),
        );
        hiddenTimelineElements = [];
      },
    },
    anchor: () => null,
    toggle: {
      label: t('timelineRulerCoachmarkToggle', 'Use ruler timeline'),
      initial: true,
      onChange: (on) => {
        setPreviewStyle(preview?.element ?? null, on);
        return setRulerTimelineEnabled(on);
      },
    },
    dismissLabel: t('coachmarkDismiss', 'Done'),
    nextLabel: t('coachmarkNext', 'Next'),
    closeLabel: t('coachmarkClose', 'Close'),
    progress: opts.progress,
  });
}

export const rulerTimelineCoachmarkStep: CoachmarkSequenceStep = {
  id: RULER_TIMELINE_COACHMARK_ID,
  isEligible: async () =>
    location.hostname === 'gemini.google.com' && !(await loadRulerIntroUnneeded()),
  show: (progress) => maybeShowRulerTimelineCoachmark({ progress }),
};

const showDebugRulerTimelineCoachmark = () => void maybeShowRulerTimelineCoachmark({ force: true });

// Debug: document.dispatchEvent(new Event('gv:debug:rulerTimelineCoachmark'))
try {
  (window as unknown as Record<string, unknown>).__gvRulerTimelineCoachmark =
    showDebugRulerTimelineCoachmark;
  document.addEventListener(RULER_TIMELINE_COACHMARK_DEBUG_EVENT, showDebugRulerTimelineCoachmark);
} catch {
  /* ignore */
}
