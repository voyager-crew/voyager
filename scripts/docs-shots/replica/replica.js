// The replica's behavior: a new-chat route, a composer that sends, and a reply
// staged ahead of time through window.__replica, so a scene can be set up
// without any real AI. Nothing leaves this page.
(() => {
  const history = document.getElementById('chat-history');
  const editor = document.querySelector('.ql-editor');
  const list = document.querySelector('.rp-list');
  const model = document.querySelector('.mode-title');
  const empty = history.innerHTML;
  let queued = [];

  const syncBlank = () => editor.classList.toggle('ql-blank', editor.textContent === '');
  new MutationObserver(syncBlank).observe(editor, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function userTurn(text) {
    const turn = el('user-query');
    const content = el('user-query-content');
    content.append(el('div', 'user-query-bubble-with-background', text));
    turn.append(content);
    return turn;
  }

  // reply: { text?: string, code?: string, language?: string }
  function modelTurn(reply) {
    const turn = el('model-response');
    turn.setAttribute('aria-label', 'Gemini response');
    const body = el('div', 'markdown');
    if (reply.text) body.append(el('p', '', reply.text));
    if (reply.code !== undefined) {
      const block = el('code-block');
      block.append(el('div', 'rp-code-head', reply.language ?? 'json'));
      const pre = el('pre');
      pre.append(el('code', '', reply.code));
      block.append(pre);
      body.append(block);
    }
    if (reply.after) body.append(el('p', '', reply.after));
    turn.append(body);
    return turn;
  }

  function addExchange(user, reply) {
    if (history.querySelector('.rp-empty')) history.innerHTML = '';
    const pair = el('div', 'conversation-container');
    pair.append(userTurn(user));
    if (reply) pair.append(modelTurn(reply));
    history.append(pair);
    history.scrollTop = history.scrollHeight;
    return pair;
  }

  function newChat() {
    history.innerHTML = empty;
  }

  function send() {
    const text = editor.innerText.trim();
    if (!text) return;
    editor.textContent = '';
    if (location.pathname === '/app') {
      window.history.pushState({}, '', `/app/${Math.random().toString(16).slice(2, 14)}`);
    }
    const pair = addExchange(text, null);
    const reply = queued.shift();
    if (reply) setTimeout(() => pair.append(modelTurn(reply)), 600);
  }

  document.querySelector('.rp-send button').addEventListener('click', send);
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  document.querySelector('.rp-new').addEventListener('click', (event) => {
    event.preventDefault();
    window.history.pushState({}, '', '/app');
    newChat();
  });
  window.addEventListener('popstate', () => {
    if (location.pathname === '/app') newChat();
  });

  window.__replica = {
    /** Queue the reply the next send gets. */
    queueReply(reply) {
      queued.push(reply);
    },
    /** Show a finished exchange at once. */
    exchange(user, reply) {
      addExchange(user, reply);
    },
    newChat,
    setModel(label) {
      model.textContent = label;
    },
    setTheme(scheme) {
      document.body.classList.toggle('dark-theme', scheme === 'dark');
      document.body.classList.toggle('light-theme', scheme !== 'dark');
    },
    setChats(titles) {
      list.replaceChildren(
        ...titles.map((title, index) => {
          const row = el('a', '', title);
          row.href = `/app/demo${index}`;
          row.setAttribute('data-test-id', 'conversation');
          return row;
        }),
      );
    },
  };
  window.__replica.setChats(['Weekend trip ideas', 'Reading list', 'Recipe for dinner']);
})();
