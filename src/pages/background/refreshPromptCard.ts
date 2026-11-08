/** The words the refresh card shows, in the person's Voyager language. */
export interface RefreshPromptText {
  readonly title: string;
  readonly body: string;
  readonly reload: string;
  readonly later: string;
  readonly rtl: boolean;
}

/**
 * Show the "Voyager updated, refresh to apply" card in a page whose Voyager
 * script belongs to the previous version. Injected through
 * `scripting.executeScript({ func })`, so it closes over nothing: every name
 * it uses is declared inside it. It reloads only when the person clicks.
 */
export function showRefreshPromptCard(text: RefreshPromptText): void {
  const HOST_ID = 'gv-update-refresh-prompt';
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  // Top right, below the site's header: the composer and Voyager's floating ball sit at the bottom.
  host.style.cssText = 'position:fixed;top:68px;right:20px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });

  const scheme = document.documentElement.getAttribute('data-gv-scheme');
  const dark =
    scheme === 'dark' ||
    (scheme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .card {
      --bg: ${dark ? '#202124' : '#ffffff'};
      --fg: ${dark ? '#e8eaed' : '#1f1f1f'};
      --muted: ${dark ? '#9aa0a6' : '#5f6368'};
      --line: ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'};
      --accent: ${dark ? '#8ab4f8' : '#0b57d0'};
      --on-accent: ${dark ? '#0b1f3a' : '#ffffff'};
      box-sizing: border-box;
      width: 300px;
      max-width: calc(100vw - 40px);
      padding: 14px 16px 12px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--bg);
      color: var(--fg);
      box-shadow: 0 8px 28px rgba(0,0,0,${dark ? '0.45' : '0.14'});
      font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
      animation: gv-in 180ms ease-out;
    }
    @keyframes gv-in { from { opacity: 0; transform: translateY(-8px); } }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
    .title { margin: 0 0 4px; font-weight: 600; }
    .body { margin: 0 0 12px; color: var(--muted); font-size: 13px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    button {
      font: inherit;
      font-size: 13px;
      padding: 6px 14px;
      border-radius: 999px;
      cursor: pointer;
      border: 1px solid transparent;
    }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .later { background: transparent; color: var(--muted); }
    .later:hover { color: var(--fg); background: var(--line); }
    .reload { background: var(--accent); color: var(--on-accent); font-weight: 600; }
    .reload:hover { filter: brightness(1.08); }
  `;

  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'status');
  card.dir = text.rtl ? 'rtl' : 'ltr';

  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = text.title;
  const body = document.createElement('p');
  body.className = 'body';
  body.textContent = text.body;

  const actions = document.createElement('div');
  actions.className = 'actions';
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'later';
  later.textContent = text.later;
  later.addEventListener('click', () => host.remove());
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'reload';
  reload.textContent = text.reload;
  reload.addEventListener('click', () => location.reload());
  actions.append(later, reload);

  card.append(title, body, actions);
  root.append(style, card);
  document.documentElement.appendChild(host);
}
