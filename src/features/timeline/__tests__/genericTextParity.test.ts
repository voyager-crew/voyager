import { afterEach, expect, it } from 'vitest';

import { userTurnText } from '../userTurnText';

afterEach(() => document.body.replaceChildren());

it.each(['https://custom.example/chat', 'https://chatgpt.com/c/1', 'https://claude.ai/chat/1'])(
  'star text keeps the original shared preferred roots on %s',
  (url) => {
    const turn = document.createElement('article');
    turn.innerHTML =
      '<span>Decorative heading</span><div class="query-text">Saved prompt</div><div data-user-message-bubble>Later fallback</div>';
    document.body.appendChild(turn);
    expect(userTurnText(turn, url)).toBe('Saved prompt');
  },
);
