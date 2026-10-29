import { isUserEvent } from '@/core/utils/userEvent';
import {
  PANEL_BOOTSTRAP_KIND,
  type PanelBootstrapMessage,
  type PanelToken,
  parsePanelBootstrapAckMessage,
} from '@/features/panel/protocol';

export interface PanelFrameBootstrap {
  readonly token: PanelToken;
  readonly origin: string;
  onInvalidated(): void;
}

/** The host may read/rewrite DOM, so authority lives only in this frame's window handoff. */
export function bindPanelFrame(
  element: HTMLDivElement,
  iframe: HTMLIFrameElement,
  url: string,
  bootstrap: PanelFrameBootstrap,
): () => void {
  const target = iframe.contentWindow;
  const life = new AbortController();
  const observer = new MutationObserver(inspect);

  function stopDelivery(): void {
    iframe.removeEventListener('load', loaded);
    window.removeEventListener('message', acknowledged);
  }

  function stop(): void {
    life.abort();
    observer.disconnect();
    stopDelivery();
  }

  function invalidated(records: MutationRecord[]): boolean {
    return (
      !element.isConnected ||
      iframe.parentNode !== element ||
      iframe.contentWindow !== target ||
      iframe.src !== url ||
      records.some(
        (record) =>
          (record.type === 'attributes' && record.target === iframe) ||
          Array.from(record.removedNodes).some(
            (node) => node === iframe || node === element || node.contains(element),
          ),
      )
    );
  }

  function inspect(records: MutationRecord[]): void {
    if (life.signal.aborted || !invalidated(records)) return;
    stop();
    bootstrap.onInvalidated();
  }

  function loaded(event: Event): void {
    if (!isUserEvent(event) || life.signal.aborted) return;
    // Also catch a change/reset or detach/reinsert whose observer callback has not run yet.
    inspect(observer.takeRecords());
    if (life.signal.aborted || !target) return;
    // An initial about:blank load can drop this send; keep trying until redemption is confirmed.
    target.postMessage(
      { kind: PANEL_BOOTSTRAP_KIND, token: bootstrap.token } satisfies PanelBootstrapMessage,
      bootstrap.origin,
    );
  }

  function acknowledged(event: MessageEvent): void {
    if (
      !isUserEvent(event) ||
      life.signal.aborted ||
      event.source !== target ||
      event.origin !== bootstrap.origin ||
      !parsePanelBootstrapAckMessage(event.data)
    )
      return;
    inspect(observer.takeRecords());
    if (!life.signal.aborted) stopDelivery();
  }

  iframe.addEventListener('load', loaded);
  window.addEventListener('message', acknowledged);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcdoc'],
  });
  return stop;
}
