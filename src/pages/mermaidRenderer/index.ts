import {
  MERMAID_RENDERER_CONNECT,
  type MermaidRendererResponse,
  parseMermaidRequest,
} from './protocol';
import { renderMermaidDocument } from './render';

const channelId = window.location.hash.slice(1);

// One request per document: rejected Mermaid Promise.all siblings remain under
// this document's CSP until the parent destroys the whole frame.
const connect = (event: MessageEvent<unknown>): void => {
  const data = event.data;
  // Firefox can redact a privileged sender's source to null; the nonce and
  // transferred port still bind this one-use connection to its creator.
  if (
    (event.source !== window.parent && event.source !== null) ||
    !channelId ||
    typeof data !== 'object' ||
    data === null ||
    !('type' in data) ||
    data.type !== MERMAID_RENDERER_CONNECT ||
    !('channelId' in data) ||
    data.channelId !== channelId ||
    !('request' in data) ||
    event.ports.length !== 1
  ) {
    return;
  }
  const request = parseMermaidRequest(data.request);
  if (!request) return;
  window.removeEventListener('message', connect);
  const port = event.ports[0];
  const respond = (response: MermaidRendererResponse): void => {
    port.postMessage(response);
    port.close();
  };
  void renderMermaidDocument(request).then(
    (result) => respond({ type: 'rendered', result }),
    () => respond({ type: 'unavailable' }),
  );
};

window.addEventListener('message', connect);
