// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/6af487fe-90fc-83eb-bd24-35c5c831a421" }
import { afterEach, describe, expect, it } from 'vitest';

import { NEW_CHAT_TARGETS } from '../newChat';

afterEach(() => {
  document.body.innerHTML = '';
});

describe("ChatGPT's new-chat control", () => {
  it('skips the home link a collapsed panel keeps under inert, and presses the home rail button', () => {
    document.body.innerHTML = `
      <aside>
        <nav data-app-navigation-rail="true">
          <button type="button" data-sidebar-destination="builtin:home">Home</button>
        </nav>
        <div inert><nav><a href="/">ChatGPT</a></nav></div>
      </aside>`;

    const control = NEW_CHAT_TARGETS.chatgpt.link(document);

    expect(control?.dataset.sidebarDestination).toBe('builtin:home');
  });

  it('presses the home link when the panel shows it', () => {
    document.body.innerHTML = `<aside><nav><a href="/">ChatGPT</a></nav></aside>`;

    expect(NEW_CHAT_TARGETS.chatgpt.link(document)?.getAttribute('href')).toBe('/');
  });

  it('finds nothing when the only home link is inert', () => {
    document.body.innerHTML = `<aside inert><nav><a href="/">ChatGPT</a></nav></aside>`;

    expect(NEW_CHAT_TARGETS.chatgpt.link(document)).toBeNull();
  });
});
