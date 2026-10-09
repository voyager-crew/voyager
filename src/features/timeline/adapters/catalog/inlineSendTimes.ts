/**
 * Send times shown in a catalog site's thread, above each user message that has
 * one, in Gemini's look (`.gv-timestamp` in `contentStyle.css`). A label sits
 * just before the message element the rail marks, as its sibling: inside the
 * host's turn, right-aligned with the bubble, and never inside the message, so
 * its text never joins the message's summary, send matching or export.
 */
import { readTurnKey } from '@/features/plugins/sends/trackUserSends';

import type { TimelineMarker } from '../../types';

const LABEL_CLASS = 'gv-timestamp gv-timestamp-user';

/** One route's labels; `labelFor` gives a user turn's text, or `null` for none. */
export class InlineSendTimes {
  private markers: readonly TimelineMarker[] = [];
  /** Each label by the message element it sits above. */
  private readonly labels = new Map<HTMLElement, HTMLElement>();

  constructor(
    private readonly turnKeyAttributes: readonly string[],
    private readonly labelFor: (turnKey: string) => string | null,
  ) {}

  update(markers: readonly TimelineMarker[]): void {
    this.markers = markers;
    this.render();
  }

  /** Brings the labels in line with the mounted messages, their stored times and the setting. */
  render(): void {
    const wanted = new Map<HTMLElement, string>();
    for (const { element } of this.markers) {
      if (!element.isConnected || !element.parentElement) continue;
      const key = readTurnKey(element, this.turnKeyAttributes);
      const text = key === null ? null : this.labelFor(key);
      if (text) wanted.set(element, text);
    }
    // Keyed by element: a turn the host re-renders gets its label once, and the old one goes.
    for (const [element, label] of this.labels) {
      if (wanted.has(element)) continue;
      label.remove();
      this.labels.delete(element);
    }
    for (const [element, text] of wanted) {
      let label = this.labels.get(element);
      if (!label) {
        label = document.createElement('div');
        label.className = LABEL_CLASS;
        this.labels.set(element, label);
      }
      if (label.textContent !== text) label.textContent = text;
      if (label.nextSibling !== element) element.before(label);
    }
  }

  destroy(): void {
    for (const label of this.labels.values()) label.remove();
    this.labels.clear();
    this.markers = [];
  }
}
