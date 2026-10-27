/** Captured on aistudio.google.com/library, 2026-10-27: navigation and main are siblings. */
export function mountRealAIStudioNavigation() {
  document.body.innerHTML = `<app-root id="app"><ms-app>
    <div class="banner-and-app-container"><div class="makersuite-layout" id="layout">
      <ms-navbar-v2 id="navbar"><div class="nav-content v3-left-nav" id="sidebar">
        <nav id="navigation"><a id="library" href="/library">Library</a>
          <ms-prompt-history-v3 id="history">
            <article role="listitem" id="row-a"><span><a class="prompt-link" id="a" href="/prompts/a">Alpha</a></span></article>
            <article role="listitem" id="row-b"><span><a class="prompt-link" id="b" href="/prompts/b">Beta</a></span></article>
          </ms-prompt-history-v3>
        </nav>
      </div></ms-navbar-v2>
      <div role="main" class="layout-wrapper" id="content"><ms-chat-turn data-turn-role="Model">Reply</ms-chat-turn></div>
    </div></div>
  </ms-app></app-root>`;
  return {
    app: element('app'),
    layout: element('layout'),
    navbar: element('navbar'),
    sidebar: element('sidebar'),
    navigation: element('navigation'),
    content: element('content'),
    library: anchor('library'),
    prompt: anchor('a'),
    row: element('row-a'),
  };
}

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLElement)) throw new Error(`Missing fixture element ${id}`);
  return value;
}

function anchor(id: string): HTMLAnchorElement {
  const value = element(id);
  if (!(value instanceof HTMLAnchorElement)) throw new Error(`Missing fixture anchor ${id}`);
  return value;
}
