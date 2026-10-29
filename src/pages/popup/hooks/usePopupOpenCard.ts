import { useEffect } from 'react';

import browser from 'webextension-polyfill';

import { PANEL_POPUP_OPEN_CARD_KEY, parsePanelPopupCard } from '@/features/panel/protocol';

import { scrollToPopupSection } from '../components/PopupToc';
import { type PopupSectionId, popupSectionAnchorId } from './usePopupSections';

/** How long the popup may take to render the card before the request lapses. */
const CARD_WAIT_MS = 3000;
const SITE_ACCESS: PopupSectionId = 'siteAccess';

async function takeOpenCardRequest(): Promise<boolean> {
  const session = browser.storage?.session;
  if (!session) return false;
  const stored: unknown = (await session.get(PANEL_POPUP_OPEN_CARD_KEY))?.[
    PANEL_POPUP_OPEN_CARD_KEY
  ];
  if (stored === undefined) return false;
  // One shot: the next popup opens where it normally would.
  await session.remove(PANEL_POPUP_OPEN_CARD_KEY);
  return parsePanelPopupCard(stored) !== null;
}

/**
 * When the browser can't ask for a site from inside the Voyager panel, the
 * background leaves a one-shot request and opens the popup. Once the tab is
 * read (so restored scroll no longer moves), the popup takes the request,
 * clears it and any saved settings search that would hide the card, and
 * brings the site access card to the top with focus on it.
 */
export function usePopupOpenCard(
  tabContextLoaded: boolean,
  setSettingsSearch: (query: string) => void,
): void {
  useEffect(() => {
    if (!tabContextLoaded) return undefined;
    let stopped = false;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frame = 0;

    const reveal = () => {
      // Two frames: the card has laid out and any restored scroll has landed.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() =>
          scrollToPopupSection(
            SITE_ACCESS,
            document.querySelector<HTMLElement>('[data-popup-header]'),
          ),
        );
      });
    };
    void takeOpenCardRequest()
      .then((requested) => {
        if (!requested || stopped) return;
        setSettingsSearch('');
        const anchor = popupSectionAnchorId(SITE_ACCESS);
        if (document.getElementById(anchor)) {
          reveal();
          return;
        }
        observer = new MutationObserver(() => {
          if (!document.getElementById(anchor)) return;
          observer?.disconnect();
          reveal();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        timer = setTimeout(() => observer?.disconnect(), CARD_WAIT_MS);
      })
      .catch(() => {
        // Without session storage the popup simply opens as usual.
      });

    return () => {
      stopped = true;
      observer?.disconnect();
      if (timer !== null) clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [setSettingsSearch, tabContextLoaded]);
}
