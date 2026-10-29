import { createRoot } from 'react-dom/client';

import { LanguageProvider } from '@/contexts/LanguageContext';
import {
  PANEL_MESSAGE,
  PANEL_TOKEN_QUERY_PARAM,
  type PanelRuntimeMessage,
  isPanelToken,
  parsePanelTokenRedeemReply,
} from '@/features/panel/protocol';
import { prepareExtensionPageLanguage } from '@/utils/extensionPageLanguage';

import { PanelApp } from './PanelApp';
import './styles/panel.css';
import './styles/rows.css';

async function init() {
  const token = new URL(window.location.href).searchParams.get(PANEL_TOKEN_QUERY_PARAM);
  if (!isPanelToken(token)) return;

  try {
    const reply: unknown = await chrome.runtime.sendMessage({
      type: PANEL_MESSAGE.tokenRedeem,
      payload: { token },
    } satisfies PanelRuntimeMessage);
    const result = parsePanelTokenRedeemReply(reply);
    if (!result?.ok) return;

    // The first frame already speaks Voyager's language.
    const initialLanguage = await prepareExtensionPageLanguage();
    const container = document.getElementById('__root');
    if (container) {
      createRoot(container).render(
        <LanguageProvider initialLanguage={initialLanguage}>
          <PanelApp session={result.session} />
        </LanguageProvider>,
      );
    }
  } catch {
    // A foreign iframe, stale token or unavailable background always stays blank.
  }
}

void init();
