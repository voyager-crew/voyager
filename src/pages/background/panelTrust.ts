import { panelHostOrigin } from '@/features/panel/protocol';

import { type PanelFrameRecord, type PanelSender, matchesPanelFrame } from './panelStorage';

/**
 * The redeemed panel frames, mirrored in memory so the synchronous sender checks in
 * runtimeMessageRouting.ts can treat a redeemed panel as an extension page (spec #1077 Part 2:
 * the sync sheet and the owners a download applies through). The panel background replaces the
 * mirror after every persisted registry change and drops a tab's frames the moment it revokes
 * them or the tab leaves the frame's origin. It starts empty, so a check that runs before the
 * startup read of storage.session refuses: it can deny a redeemed frame, never admit another.
 */
class RedeemedPanelFrames {
  private frames: readonly PanelFrameRecord[] = [];

  replace(frames: readonly PanelFrameRecord[]): void {
    this.frames = frames.map((frame) => ({ ...frame }));
  }

  /** Drops the tab's frames; with `nextUrl`, only those whose page origin it leaves. */
  forget(tabId: number, nextUrl?: string): void {
    const nextOrigin = nextUrl === undefined ? null : panelHostOrigin(nextUrl);
    this.frames = this.frames.filter(
      (frame) => frame.tabId !== tabId || (nextOrigin !== null && frame.hostOrigin === nextOrigin),
    );
  }

  find(sender: PanelSender): PanelFrameRecord | null {
    return this.frames.find((frame) => matchesPanelFrame(sender, frame)) ?? null;
  }
}

export const redeemedPanelFrames = new RedeemedPanelFrames();

/** This extension's panel page in the very frame (tab, frame, document) a token was redeemed in. */
export function isRedeemedPanelFrame(sender: PanelSender): boolean {
  return redeemedPanelFrames.find(sender) !== null;
}

/** The page under a redeemed panel, from its session, for browsers that omit `sender.tab.url`. */
export function redeemedPanelPageUrl(sender: PanelSender): string | undefined {
  return redeemedPanelFrames.find(sender)?.context.pageUrl;
}
