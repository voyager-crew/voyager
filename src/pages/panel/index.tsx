import { createRoot } from 'react-dom/client';

import {
  PANEL_MESSAGE,
  PANEL_TOKEN_QUERY_PARAM,
  type PanelRuntimeMessage,
  isPanelToken,
  parsePanelTokenRedeemReply,
} from '@/features/panel/protocol';

import { PanelApp } from './PanelApp';

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

    const container = document.getElementById('__root');
    if (container) createRoot(container).render(<PanelApp session={result.session} />);
  } catch {
    // A foreign iframe, stale token or unavailable background always stays blank.
  }
}

void init();
