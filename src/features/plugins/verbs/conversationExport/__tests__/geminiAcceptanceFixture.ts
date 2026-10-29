export const GEMINI_ACCEPTANCE_ROUTE = '/u/3/app/abc';
export const GEMINI_ACCEPTANCE_TITLE = 'Voyager 测试';
export const GEMINI_RASTER_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1kAAAAASUVORK5CYII=';

function responseActions(): string {
  return `
    <message-actions>
      <div class="actions-container-v2"><div class="buttons-container-v2">
        <button class="mdc-icon-button mat-mdc-icon-button" data-test-id="copy-button" aria-label="Copy response">
          <mat-icon fonticon="content_copy">content_copy</mat-icon>
        </button>
        <button class="mdc-icon-button mat-mdc-icon-button" data-test-id="more-menu-button" aria-label="More" aria-haspopup="menu" aria-expanded="false">
          <mat-icon fonticon="more_vert">more_vert</mat-icon>
        </button>
      </div></div>
    </message-actions>`;
}

export const GEMINI_CONVERSATION_HTML = `
  <div class="conversation-container" id="r_aaaaaaaa01">
    <user-query>
      <div class="user-query-container">
        <div class="query-text-line">Explain the integral</div>
        <div class="query-text-line">with an example</div>
      </div>
    </user-query>
    <model-response>
      <div class="response-container">
        <model-thoughts>
          <message-content><div class="markdown">hidden reasoning that must stay out of the export</div></message-content>
        </model-thoughts>
        <message-content><div class="markdown markdown-main-panel">
          <h2>Overview</h2>
          <p>Inline <span class="math-inline" data-math="x^2">x2</span> and <b>bold</b> text.</p>
          <div class="math-block" data-math="\\int_0^1 x\\,dx"></div>
          <ul><li>first</li><li>second <code>value</code></li></ul>
          <code-block><div class="code-block">
            <div class="code-block-decoration"><span>Python</span></div>
            <pre><code data-test-id="code-content">print("hi")</code></pre>
          </div></code-block>
          <table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
          <blockquote><p>quoted</p></blockquote>
          <generated-image><img class="image" src="${GEMINI_RASTER_IMAGE}" alt="One pixel diagram" width="1" height="1"></generated-image>
          <hr><p>Done.</p>
        </div></message-content>
        ${responseActions()}
      </div>
    </model-response>
  </div>
  <div class="conversation-container" id="r_bbbbbbbb02">
    <user-query><div class="user-query-container"><div class="query-text-line">Write the result in Canvas</div></div></user-query>
    <model-response><div class="response-container">
      <message-content><div class="markdown"><p>The document is ready.</p></div></message-content>
      <immersive-entry-chip><span>Integral notes</span></immersive-entry-chip>
      ${responseActions()}
    </div></model-response>
  </div>`;

export const GEMINI_CANVAS_HTML = `
  <immersive-editor>
    <header class="immersive-editor-header"><h1 data-test-id="canvas-title">Integral notes</h1></header>
    <div class="ProseMirror" contenteditable="true">
      <h2>Worked example</h2>
      <p>The definite integral is <strong>one half</strong>.</p>
      <ul><li>Choose the interval.</li><li>Evaluate the antiderivative.</li></ul>
      <pre><code>result = 1 / 2</code></pre>
    </div>
  </immersive-editor>`;

export const GEMINI_REPORT_HTML = `
  <deep-research-immersive-panel>
    <thinking-panel>
      <thought-item><div class="thought-header">Gathering evidence</div><div class="gds-body-m gds-italic">thinking notes that must not become the report</div></thought-item>
      <message-content><div class="markdown">Unfinished research draft</div></message-content>
    </thinking-panel>
    <message-content><div class="markdown markdown-main-panel">
      <h1>Solar Report</h1>
      <p>Panels convert <span class="math-inline" data-math="h\\nu">hv</span> into current.</p>
      <h2>Findings</h2>
      <ul><li>Efficiency rose.</li></ul>
      <table><thead><tr><th>Year</th><th>Efficiency</th></tr></thead><tbody><tr><td>2025</td><td>24%</td></tr></tbody></table>
      <code-block><div class="code-block"><div class="code-block-decoration"><span>Python</span></div><pre><code data-test-id="code-content">efficiency = 0.24</code></pre></div></code-block>
      <generated-image><img class="image" src="${GEMINI_RASTER_IMAGE}" alt="Solar cell diagram" width="1" height="1"></generated-image>
      <p><a href="https://example.test/solar">Research source</a></p>
    </div></message-content>
    <button data-test-id="report-menu-trigger" aria-label="Report actions" aria-haspopup="menu" aria-expanded="false">More</button>
  </deep-research-immersive-panel>`;

export interface GeminiAcceptanceFixtureOptions {
  route?: string;
  conversationHtml?: string;
  canvas?: boolean;
  report?: boolean;
}

function required<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Gemini fixture element missing: ${selector}`);
  return element;
}

function nativeMenuItem(testId: string, text: string, icon: string): string {
  return `<button class="mat-mdc-menu-item" role="menuitem" data-test-id="${testId}">
    <mat-icon fonticon="${icon}">${icon}</mat-icon>
    <span class="mat-mdc-menu-item-text"><span class="gds-label-m">${text}</span></span>
  </button>`;
}

/** Native-shaped DOM only: the production plugin injects and handles every export action. */
export function mountGeminiAcceptanceFixture(options: GeminiAcceptanceFixtureOptions = {}) {
  const route = options.route ?? GEMINI_ACCEPTANCE_ROUTE;
  const routeUrl = new URL(route, location.origin);
  const account = routeUrl.pathname.match(/^\/u\/\d+(?=\/)/)?.[0] ?? '';
  history.replaceState(null, '', routeUrl.pathname + routeUrl.search);
  document.title = GEMINI_ACCEPTANCE_TITLE;
  document.body.className = 'lr26';
  document.body.innerHTML = `
    <header>
      <span data-test-id="conversation-title">${GEMINI_ACCEPTANCE_TITLE}</span>
      <button data-test-id="actions-menu-button" aria-label="Conversation actions" aria-haspopup="menu" aria-expanded="false">More</button>
    </header>
    <nav data-test-id="overflow-container"><div data-test-id="all-conversations">
      <div data-test-id="conversation" jslog="conversation; c_abc">
        <a href="${account}/app/abc" aria-label="${GEMINI_ACCEPTANCE_TITLE}"><span class="conversation-title-text">${GEMINI_ACCEPTANCE_TITLE}</span></a>
        <button data-test-id="conversation-actions-menu-icon-button" aria-label="More options for ${GEMINI_ACCEPTANCE_TITLE}" aria-haspopup="menu" aria-expanded="false">More</button>
      </div>
      <div data-test-id="conversation" jslog="conversation; c_other">
        <a href="${account}/app/other" aria-label="Another conversation"><span class="conversation-title-text">Another conversation</span></a>
        <button data-test-id="conversation-actions-menu-icon-button" aria-label="More options for Another conversation" aria-haspopup="menu" aria-expanded="false">More</button>
      </div>
    </div></nav>
    <main><div id="chat-history">${options.conversationHtml ?? GEMINI_CONVERSATION_HTML}</div></main>
    ${options.canvas === false ? '' : GEMINI_CANVAS_HTML}
    ${options.report ? GEMINI_REPORT_HTML : ''}`;

  const conversation = required<HTMLElement>('#chat-history');
  let menuNumber = 0;
  const openMenu = (trigger: HTMLElement, items: string): HTMLElement => {
    document.querySelectorAll('.mat-mdc-menu-panel').forEach((panel) => panel.remove());
    document.querySelectorAll('[aria-expanded="true"]').forEach((element) => {
      element.setAttribute('aria-expanded', 'false');
    });
    const id = `gemini-acceptance-menu-${++menuNumber}`;
    trigger.setAttribute('aria-controls', id);
    trigger.setAttribute('aria-expanded', 'true');
    const panel = document.createElement('div');
    panel.id = id;
    panel.className = 'mat-mdc-menu-panel';
    panel.setAttribute('role', 'menu');
    panel.innerHTML = `<div class="mat-mdc-menu-content">${items}</div>`;
    document.body.appendChild(panel);
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return panel;
  };

  // Gemini's own link is the SPA navigation boundary used by sidebar export.
  document.querySelectorAll<HTMLAnchorElement>('nav a[href]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      history.pushState(null, '', link.href);
    });
  });

  return {
    conversation,
    topUser: () => required<HTMLElement>('.user-query-container', conversation),
    replaceConversation(html = GEMINI_CONVERSATION_HTML) {
      conversation.innerHTML = html;
    },
    removeCanvasOnPreload() {
      required<HTMLElement>('.user-query-container', conversation).addEventListener(
        'click',
        () => document.querySelectorAll('immersive-editor').forEach((editor) => editor.remove()),
        { once: true },
      );
    },
    openConversationMenu() {
      return openMenu(
        required<HTMLElement>('header [data-test-id="actions-menu-button"]'),
        nativeMenuItem('pin-button', 'Pin', 'keep'),
      );
    },
    openSidebarMenu(id = 'abc') {
      return openMenu(
        required<HTMLElement>(
          `[data-test-id="conversation"][jslog*="c_${id}"] [data-test-id="conversation-actions-menu-icon-button"]`,
        ),
        nativeMenuItem('pin-button', 'Pin', 'keep'),
      );
    },
    openResponseMenu(index = 0) {
      const trigger = conversation.querySelectorAll<HTMLElement>(
        '[data-test-id="more-menu-button"]',
      )[index];
      if (!trigger) throw new Error(`Gemini fixture response missing: ${index}`);
      return openMenu(
        trigger,
        nativeMenuItem('export-response-to-docs', 'Export to Docs', 'docs') +
          nativeMenuItem('report-response', 'Report', 'flag'),
      );
    },
    renderReport() {
      document.querySelector('deep-research-immersive-panel')?.remove();
      document.body.insertAdjacentHTML('beforeend', GEMINI_REPORT_HTML);
      return required<HTMLElement>('deep-research-immersive-panel');
    },
    openReportMenu() {
      return openMenu(
        required<HTMLElement>('[data-test-id="report-menu-trigger"]'),
        nativeMenuItem('share-button-tooltip-container', 'Share report', 'share') +
          nativeMenuItem('export-to-docs-button', 'Export to Docs', 'docs') +
          nativeMenuItem('copy-button', 'Copy', 'content_copy'),
      );
    },
  };
}
