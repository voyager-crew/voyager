/** Host DOM fixtures shared by the diagram export regression tests. */
/** Gemini's code block: label and copy button in the decoration, source in `code-content`. */
export function geminiCodeBlock(source: string, label: string): string {
  const code = document.createElement('code');
  code.setAttribute('data-test-id', 'code-content');
  code.textContent = source;
  return (
    '<code-block><div class="code-block">' +
    `<div class="code-block-decoration"><span>${label}</span>` +
    '<div class="buttons"><button class="copy-button">copy</button></div></div>' +
    `<pre>${code.outerHTML}</pre></div></code-block>`
  );
}

export function geminiReply(markdown: string): HTMLElement {
  const reply = document.createElement('model-response');
  reply.innerHTML = `<message-content><div class="markdown">${markdown}</div></message-content>`;
  document.querySelector('main')!.append(reply);
  return reply;
}

export const panelOf = (root: Element) => root.querySelector<HTMLElement>('.gv-diagram-panel');
export const toolbarButtons = (root: Element) =>
  Array.from(panelOf(root)?.shadowRoot?.querySelectorAll('button') ?? []);
export const drawn = (root: Element) =>
  panelOf(root)?.shadowRoot?.querySelector('.diagram')?.textContent ?? null;
/** A ChatGPT reply with a `pre` code block, as the mermaid primitive's own tests model it. */
export function chatgptReply(source: string, { inList = false } = {}): HTMLElement {
  const reply = document.createElement('div');
  reply.setAttribute(
    'data-chatgpt-selection-message-id',
    `m${document.querySelectorAll('*').length}`,
  );
  const block =
    '<pre class="overflow-visible!"><div class="contain-inline-size">' +
    '<div class="flex items-center">mermaid</div>' +
    '<div class="sticky"><button aria-label="Copy">Copy code</button></div>' +
    '<div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-mermaid"></code></div>' +
    '</div></pre>';
  reply.innerHTML = inList
    ? `<div class="markdown"><ol><li><p>Here it is:</p>${block}</li></ol></div>`
    : `<div class="markdown"><p>Here it is:</p>${block}</div>`;
  reply.querySelector('code')!.textContent = source;
  document.querySelector('main')!.append(reply);
  return reply;
}

export const fenced = (language: string, source: string) => `\`\`\`${language}\n${source}\n\`\`\``;
