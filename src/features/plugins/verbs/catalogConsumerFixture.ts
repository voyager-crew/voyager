import { initializeSiteSelectors } from '@/core/selectors';
import { withGuardedPageAdapter } from '@/core/selectors/semanticSnapshot';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { PluginScope } from '../runtime/pluginScope';
import type { PrimitiveContext } from './types';

/** A renamed native ChatGPT message, used by the consumer operation regressions. */
export function catalogConsumerPage(native = false): void {
  document.body.innerHTML = `<main>
    <section data-message-role="user" class="prompt" ${native ? 'data-user-message-bubble' : ''}>Question $x$</section>
    <section data-message-role="assistant" class="answer" ${native ? 'data-chatgpt-selection-message-id="reply"' : ''}>
      <p id="quote">Answer</p><table><tbody><tr><td>Cell</td></tr></tbody></table>
      <div class="block" ${native ? 'data-markdown-copy="code-block"' : ''}><pre><code class="language-mermaid">flowchart TD\nA-->B</code></pre></div>
    </section></main><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="submit">Send</button></form>`;
}

export async function catalogConsumerPatch(): Promise<() => void> {
  const lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'chatgpt',
      catalogRevision: 1,
      selectors: {
        userTurn: '.prompt',
        assistantTurn: '.answer',
        codeBlock: '.block',
      },
    }),
  });
  await lifetime.ready;
  return lifetime.stop;
}

export function catalogConsumerContext(): PrimitiveContext {
  return {
    doc: document,
    adapter: withGuardedPageAdapter(requireBundledSiteAdapter('chatgpt'), document),
    pluginId: 'test.catalog-consumer',
    settings: {},
    setTargetCounter: () => {},
  };
}

export function moveToDialog(element: Element): void {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  dialog.append(element);
}

export { PluginScope };
