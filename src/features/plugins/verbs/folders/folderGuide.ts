/**
 * One-time guide that points at the folder section in a site's sidebar, on the
 * shared coachmark (`src/pages/content/coachmark`). It is checked after every
 * sidebar change, scroll, resize and change in the header's visibility, never on
 * a timer. It shows only once the folders have loaded and the section header is
 * actually on screen (not scrolled out of the sidebar, not collapsed away), and
 * never over an open menu or dialog; until then it waits. Seen state is the
 * shared coachmark list, so it shows once per user. Turning the plugin off, or
 * the header leaving the screen, closes an open guide without marking it seen.
 */
import { LAYER_ATTR } from '@/core/ui/layer';
import { detectRTL } from '@/core/utils/rtl';
import type { Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';
import { timelineSiteData } from '@/features/timeline/siteTextData';
import { type CoachmarkResult, hasSeenCoachmark, showCoachmark } from '@/pages/content/coachmark';
import { FLOATING_PANEL_CLASS } from '@/pages/content/folder/floatingTree/shared';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import { isOnScreen } from './anchorVisibility';
import { FOLDER_PICKER_CLASS } from './folderPicker';
import type { SiteFolderGuideConfig } from './types';

const FOLDER_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Z"/></svg>';

/** The site's own menus and dialogs, plus the folder picker and Voyager's confirms. */
const OVERLAY_SELECTOR = [`.${FOLDER_PICKER_CLASS}`, `[${LAYER_ATTR}="popover"]`].join(',');

/**
 * Neither blocks the guide: the guide itself, and the floating folder panel, a
 * non-modal `role="dialog"` that users may keep open across visits.
 */
const NOT_OVERLAYS = `.gv-coach, .${FLOATING_PANEL_CLASS}`;

/** CSS-hidden panels stay mounted; only visible overlays should block the guide. */
export function hasOpenOverlay(doc: Document = document): boolean {
  for (const element of doc.querySelectorAll<HTMLElement>(
    `${timelineSiteData(doc)['guide.overlays'].join(',')},${OVERLAY_SELECTOR}`,
  )) {
    if (element.closest(NOT_OVERLAYS)) continue;
    if (element.hidden || element.closest('[aria-hidden="true"], [data-state="closed"]')) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const visibility = doc.defaultView?.getComputedStyle(element).visibility;
    if (visibility === 'hidden' || visibility === 'collapse') continue;
    return true;
  }
  return false;
}

export interface FolderGuideTarget {
  /** The element the bubble points at, or null while the section is out of the page. */
  anchor(): HTMLElement | null;
  /** True once the folders have loaded. */
  ready(): boolean;
  /** True while the section's own menu or name field is open. */
  busy(): boolean;
}

type GuideState = 'idle' | 'pending' | 'showing' | 'done';

export class SiteFolderGuide {
  private state: GuideState = 'idle';
  private readonly open = new Set<AbortController>();
  /** Re-check triggers; released once the guide has been seen. */
  private readonly triggers: Dispose[] = [];
  private visibility: IntersectionObserver | null = null;
  private observed: HTMLElement | null = null;
  private checkQueued = false;

  /** `label` names the plugin's effects, e.g. `chatgpt-folders`. */
  constructor(
    private readonly scope: PluginScope,
    private readonly config: SiteFolderGuideConfig,
    private readonly target: FolderGuideTarget,
    label: string,
  ) {
    scope.effect(
      () => () => {
        this.state = 'done';
        for (const controller of this.open) controller.abort();
        this.open.clear();
        this.visibility?.disconnect();
        this.visibility = null;
      },
      `${label}:guide`,
    );
    scope.on(document, config.debugEvent, () => void this.present(false));
    // Scrolling the sidebar, resizing, or showing a collapsed sidebar can bring
    // the header on screen without any change inside the sidebar.
    this.triggers.push(
      scope.on(document, 'scroll', (event) => this.onScroll(event), {
        capture: true,
        passive: true,
      }),
      scope.on(window, 'resize', () => this.queueCheck(), { passive: true }),
    );
  }

  /** Whether the guide could show now. Reads only. */
  isEligible(): boolean {
    if (this.scope.isDisposed || !this.target.ready() || this.target.busy()) return false;
    const anchor = this.target.anchor();
    return !!anchor && isOnScreen(anchor) && !hasOpenOverlay();
  }

  /** Called after every sidebar change, and by the guide's own triggers. */
  check(): void {
    this.watch(this.target.anchor());
    if (this.state === 'showing') {
      // The header was dropped, scrolled away or hidden: close without marking
      // the guide seen, and wait for the header to come back.
      const anchor = this.target.anchor();
      if (!anchor || !isOnScreen(anchor)) for (const controller of this.open) controller.abort();
      return;
    }
    if (this.state !== 'idle' || !this.isEligible()) return;
    this.state = 'pending';
    void this.run();
  }

  /** At most one check per frame, however many events arrive. */
  private queueCheck(): void {
    if (this.checkQueued || this.state === 'done' || this.scope.isDisposed) return;
    this.checkQueued = true;
    this.scope.frame(() => {
      this.checkQueued = false;
      this.check();
    });
  }

  /** Only a scroll of something that holds the section can move the header. */
  private onScroll(event: Event): void {
    const anchor = this.target.anchor();
    if (!anchor) return;
    const root = anchor.getRootNode();
    const holder = root instanceof ShadowRoot ? root.host : anchor;
    const scrolled = event.target;
    if (scrolled === document || (scrolled instanceof Node && scrolled.contains(holder))) {
      this.queueCheck();
    }
  }

  /** Follows the header's visibility, which catches a sidebar being shown again. */
  private watch(anchor: HTMLElement | null): void {
    if (!anchor || anchor === this.observed || this.state === 'done') return;
    if (typeof IntersectionObserver !== 'function' || this.scope.isDisposed) return;
    // Threshold 1 reports the moment a sliding sidebar has fully brought it in.
    this.visibility ??= new IntersectionObserver(() => this.queueCheck(), { threshold: [0, 1] });
    if (this.observed) this.visibility.unobserve(this.observed);
    this.visibility.observe(anchor);
    this.observed = anchor;
  }

  /** Seen: nothing left to wait for. */
  private finish(): void {
    this.state = 'done';
    for (const release of this.triggers.splice(0)) void release();
    this.visibility?.disconnect();
    this.visibility = null;
    this.observed = null;
  }

  private async run(): Promise<void> {
    const seen = await hasSeenCoachmark(this.config.id);
    if (this.state !== 'pending') return;
    if (seen) {
      this.finish();
      return;
    }
    // A menu may have opened while the seen list loaded.
    if (!this.isEligible()) {
      this.state = 'idle';
      return;
    }
    this.state = 'showing';
    const result = await this.present(true);
    if (this.state !== 'showing') return;
    // Skipped means it never showed or was interrupted: try again on a later change.
    if (result === 'skipped') this.state = 'idle';
    else this.finish();
  }

  private async present(once: boolean): Promise<CoachmarkResult> {
    if (this.scope.isDisposed) return 'skipped';
    const controller = new AbortController();
    this.open.add(controller);
    try {
      return await showCoachmark({
        id: this.config.id,
        once,
        icon: FOLDER_ICON,
        title: t(this.config.titleKey),
        body: t(this.config.bodyKey),
        anchor: () => this.target.anchor(),
        dismissLabel: t('coachmarkDismiss'),
        closeLabel: t('coachmarkClose'),
        placement: 'top',
        // Plugin sites do not set Gemini's body.gv-rtl class.
        rtl: detectRTL(),
        signal: controller.signal,
      });
    } finally {
      this.open.delete(controller);
    }
  }
}
