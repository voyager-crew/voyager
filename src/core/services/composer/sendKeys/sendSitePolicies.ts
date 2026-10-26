/**
 * How Gemini and AI Studio take over Enter in their composers.
 *
 * Both keep the legacy shape: one capture listener on every editable (main
 * box, edit boxes and dialogs) that only calls `stopPropagation`, so every
 * document-capture listener (Folder Project, prompt history, slash prompt) has
 * already run when a send fires. Chosen from the page's own host, never from a
 * manifest.
 */
import { getBundledGeminiSelectorView } from '@/core/gemini/selectors';
import aistudioPackaged from '@/features/plugins/catalog/sites/aistudio/selector-data/input-packaged.json';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/composer-send-packaged.json';

import type { SendKeyMode, SendKeyRule } from './sendKeyIntent';

export type SendSiteId = 'gemini' | 'aistudio';

export interface SendSitePolicy {
  readonly site: SendSiteId;
  /** Elements that get the keydown listener. */
  readonly editableSelector: string;
  /** Closest wrapper holding both the input and its own send button, first match wins. */
  readonly sendContainerSelectors: readonly string[];
  readonly mainModes: Readonly<Partial<Record<SendKeyMode, SendKeyRule>>>;
  /** Plain Enter clicks send, for Safari's double-Enter bug; null where the site has none. */
  readonly safariFallback: SendKeyRule | null;
}

export const SEND_SITE_POLICIES: Readonly<Record<SendSiteId, SendSitePolicy>> = {
  gemini: {
    site: 'gemini',
    editableSelector: packaged['composer.keyEditables'],
    sendContainerSelectors: getBundledGeminiSelectorView().profiles['composer.sendContainers'],
    mainModes: {
      // Ctrl is read first, so Ctrl+Shift+Enter sends; Alt+Enter is a Voyager newline.
      ctrlEnterSends: {
        ctrlEnter: 'send',
        shiftEnter: 'host',
        altEnter: 'newline',
        plainEnter: 'newline',
      },
    },
    safariFallback: {
      ctrlEnter: 'host',
      shiftEnter: 'host',
      altEnter: 'host',
      plainEnter: 'send',
    },
  },
  aistudio: {
    site: 'aistudio',
    editableSelector: aistudioPackaged['composer.keyEditables'],
    sendContainerSelectors: aistudioPackaged['composer.sendContainers'],
    mainModes: {
      enterSends: {
        ctrlEnter: 'newline',
        shiftEnter: 'host',
        altEnter: 'host',
        plainEnter: 'send',
      },
    },
    safariFallback: null,
  },
};
