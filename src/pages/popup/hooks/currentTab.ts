import type { PanelTabRequest } from '@/features/panel/tabRequests';

/** Sends one allowlisted request to the page's content script and resolves with its reply. */
export type TabRequester = (request: PanelTabRequest) => Promise<unknown>;

/**
 * The page a popup or the panel works on, and how to ask its content script.
 * The popup fills it from `tabs`; the panel page fills it from its redeemed
 * session and asks through the background relay, because it must never touch
 * `tabs` (an embedded extension frame crashes Safari's tab and has no `tabs`
 * on Firefox).
 */
export interface CurrentTab {
  readonly activeUrl: string;
  /** False until the page is known, so nothing reads the remote catalog of the wrong host. */
  readonly activeTabContextLoaded: boolean;
  /** Null while there is no page to ask; a page without a content script rejects. */
  readonly requestTab: TabRequester | null;
}
