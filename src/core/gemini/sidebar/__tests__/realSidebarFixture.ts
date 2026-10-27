/** Text-free host capture from Gemini, 2026-10-27: one main owns sidebar and chat. */
export function mountRealGeminiSidebar(rowCount = 24) {
  const appRoot = document.createElement('chat-app-orchestrator');
  appRoot.id = 'app-root';
  const ids = Array.from({ length: rowCount }, (_, index) =>
    (index + 1).toString(16).padStart(16, '0'),
  );
  appRoot.innerHTML = `<chat-app class="side-nav-open"><main>
    <div class="side-nav-menu-button hide-on-print"><button aria-controls="native-sidebar" aria-expanded="true"></button></div>
    <side-navigation-v2 class="content"><chat-notifications></chat-notifications>
      <bard-sidenav-container><bard-sidenav id="native-sidebar" role="navigation">
        <side-navigation-content><div class="sidenav-with-history-container">
          <div data-test-id="overflow-container" class="overflow-container">
            <div><mat-nav-list role="navigation"><a data-test-id="gems-side-nav-entry-button" href="/gems/view">Gems</a><button id="sidebar-action">Action</button></mat-nav-list></div>
            <infinite-scroller style="overflow-y:auto">
              <expandable-section storagekey="notebooks"></expandable-section>
              <expandable-section data-test-id="chats-expandable-section" storagekey="chats">
                <div data-test-id="expandable-section-content"><div class="expandable-section-content-inner"><div class="chat-history"><div class="chat-history-list">
                  <conversations-list data-test-id="all-conversations"><mat-nav-list role="navigation">${ids.map((id, index) => `<gem-nav-list-item data-test-id="conversation" jslog='["c_${id}"]'><a href="/app/${id}" aria-label="Chat ${index + 1}"><span class="title-text" data-test-id="conversation-title">Chat ${index + 1}</span></a></gem-nav-list-item>`).join('')}</mat-nav-list></conversations-list>
                </div></div></div></div>
              </expandable-section>
            </infinite-scroller><mat-action-list></mat-action-list>
          </div>
        </div></side-navigation-content>
      </bard-sidenav><bard-sidenav-content><div><div><div><chat-window>
        <infinite-scroller class="chat-history">${Array.from({ length: 10 }, (_, index) => `<div class="conversation-container"><user-query id="user-query-${index}"><span class="query-text-line">Question ${index + 1}</span></user-query><model-response><message-content>Answer ${index + 1}</message-content></model-response></div>`).join('')}</infinite-scroller>
      </chat-window></div></div></div></bard-sidenav-content></bard-sidenav-container>
    </side-navigation-v2><top-bar-actions></top-bar-actions>
  </main></chat-app>`;
  document.body.append(appRoot);
  const find = (selector: string) => {
    const node = appRoot.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`Missing captured Gemini fixture node: ${selector}`);
    return node;
  };
  return {
    appRoot,
    host: find('chat-app'),
    main: find('main'),
    container: find('bard-sidenav-container'),
    sidebarHost: find('bard-sidenav'),
    content: find('side-navigation-content'),
    sidebar: find('[data-test-id="overflow-container"]'),
    sectionParent: find('bard-sidenav infinite-scroller'),
    notebooksSection: find('[storagekey="notebooks"]'),
    recentsSection: find('[storagekey="chats"]'),
    conversationList: find('conversations-list mat-nav-list'),
    rows: Array.from(appRoot.querySelectorAll<HTMLElement>('[data-test-id="conversation"]')),
    chatContent: find('bard-sidenav-content'),
    chatWindow: find('chat-window'),
    action: find('mat-nav-list > button'),
    toggle: find('.side-nav-menu-button button'),
    ids,
  };
}
