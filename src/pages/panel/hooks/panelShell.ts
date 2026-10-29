import { PANEL_SHELL_MESSAGE, type PanelShellMessage } from '@/features/panel/protocol';

/** The content-script shell that frames this page, reached only by window messages. */
export interface PanelShell {
  readonly post: (message: PanelShellMessage) => void;
  readonly close: () => void;
}

/**
 * Messages go to `window.parent` at the host origin the background confirmed
 * for this session, so no other page that frames the panel can read them.
 */
export function createPanelShell(hostOrigin: string): PanelShell {
  const post = (message: PanelShellMessage) => {
    try {
      window.parent.postMessage(message, hostOrigin);
    } catch {
      // The frame is being torn down.
    }
  };
  return { post, close: () => post({ kind: PANEL_SHELL_MESSAGE.close }) };
}
