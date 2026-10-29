import { act } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PANEL_POPUP_OPEN_CARD_KEY, PANEL_SITE_ACCESS_CARD } from '@/features/panel/protocol';

import { en, local, mount, session } from './popupHarness';

const card = () => document.getElementById('gv-popup-section-siteAccess');
/** The card scrolls once it has laid out, two frames after it renders. */
const settle = () =>
  act(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
      ),
  );
const scrollIntoView = vi.fn();

beforeEach(() => {
  // jsdom lays nothing out, so it has no scrolling to do.
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe('Popup opened by the panel', () => {
  it('brings the site access card to the top with focus on it, and only once', async () => {
    session[PANEL_POPUP_OPEN_CARD_KEY] = PANEL_SITE_ACCESS_CARD;
    await mount();
    await settle();

    expect(session).not.toHaveProperty(PANEL_POPUP_OPEN_CARD_KEY);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(card());
    expect(document.activeElement?.textContent).toBe(en.siteAccessTitle);
    expect(card()?.contains(document.activeElement)).toBe(true);
  });

  it('clears a saved settings search that would hide the card, then brings the card up', async () => {
    local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = 'mermaid';
    session[PANEL_POPUP_OPEN_CARD_KEY] = PANEL_SITE_ACCESS_CARD;
    await mount();
    await vi.waitFor(async () => {
      await settle();
      expect(scrollIntoView).toHaveBeenCalledOnce();
    });

    expect(scrollIntoView.mock.contexts[0]).toBe(card());
    expect(card()?.contains(document.activeElement)).toBe(true);
    expect(local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]).toBe('');
  });

  it('opens where it normally would without that request', async () => {
    await mount();
    await settle();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(card()?.contains(document.activeElement)).toBe(false);
  });

  it('ignores a value it does not know, and still clears it', async () => {
    session[PANEL_POPUP_OPEN_CARD_KEY] = 'cloud-sync';
    await mount();
    await settle();

    expect(session).not.toHaveProperty(PANEL_POPUP_OPEN_CARD_KEY);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
