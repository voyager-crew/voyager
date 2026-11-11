# Voyager plugins that run code (scripted tier)

You were sent here from a Voyager create page because the request may need JavaScript. Everything on that page still applies (fields, "matches", engine, reply format) except what this page changes. First check whether a primitive in https://voyager.nagi.fun/skills/write-voyager-plugin/primitives.md or plain CSS and page changes already do it: then write that declarative plugin instead, because it runs on every browser and the user has less to review.

## Manifest

- "tier": "scripted".
- "contributes": { "script": { "source": "<JavaScript>" } } and nothing else: no "styles", "domOps", "settings" or "theme". Style what you add from the script itself (inline styles, or a <style> element you add). The source is at most 200,000 characters, as a JSON string (newlines written as \n).
- "matches", "id", "engine" and the other fields as on the create page. There are no settings: put any value the user may want to change in a named constant at the top of the source.

## How it runs

- Voyager registers it with Chrome’s userScripts API. It runs once the page’s document has loaded (document idle), in the top frame only, in its own isolated world: it shares the page’s DOM but not its JavaScript globals, and cannot use any browser extension API.
- It runs again on every full page load, and only then. The chat site is a single-page app: opening another conversation or a new chat does not reload the page, so watch for that yourself (compare location.pathname on a timer, or observe a container the site keeps).
- Turning the plugin off takes effect when the page reloads. Keep changes additive and give every element you add a gv-plugin-<name> class.

## Rules

- Never observe your own DOM changes: ignore mutations of nodes you added, or disconnect while you write, and debounce. Voyager disconnects a MutationObserver whose callback runs more than 200 times in a second, and raises any setInterval delay below 50 ms to 50 ms.
- No network: no fetch, XMLHttpRequest, WebSocket, remote images, fonts or scripts, no eval, new Function or code from strings. The plugin’s world blocks its own requests; do not try to get around it.
- Change the page through the DOM: create elements and set textContent, never innerHTML (some sites enforce Trusted Types).
- Read the page’s text only for what the request needs, and keep it on the page. To remember something across visits, use one localStorage key named after the plugin.
- Write clean, readable source: the user reads all of it before turning the plugin on. One comment line at the top saying what it does, short functions, plain names, no minified or obfuscated code.
- Find elements with the selectors below where one fits (they can change when the site is redesigned), and handle their absence: return quietly when an element is missing.

## Where it runs

The user needs desktop Chrome or Edge 133 or later, with "Allow User Scripts" turned on for Voyager on its details page in chrome://extensions (Developer mode before Chrome 138). Voyager walks them through the toggle. Elsewhere (Safari, Firefox, phones) the plugin installs paused. Before the json block, say in one line that this plugin runs code and needs that toggle.

## Selectors Voyager uses on each site

- Gemini:
  - userTurn: `.user-query-bubble-with-background, .user-query-bubble-container, .user-query-container, user-query-content .user-query-bubble-with-background, user-query-content, user-query, div[aria-label="User message"], article[data-author="user"], article[data-turn="user"], [data-message-author-role="user"], div[role="listitem"][data-user="true"]`
  - assistantTurn: `[aria-label="Gemini response"], [data-message-author-role="assistant"], [data-message-author-role="model"], article[data-author="assistant"], article[data-turn="assistant"], article[data-turn="model"], model-response, .model-response, response-container, .response-container, .presented-response-container, div[role="listitem"]:not([data-user="true"])`
  - codeBlock: `code-block`
  - composer: `input-area-v2, rich-textarea, .text-input-field`
  - sidebar: `bard-sidenav, .gv-folder-container`
  - scrollContainer: `#chat-history, infinite-scroller.chat-history, .chat-history-scroll-container`
  - composerRoot: `.text-input-field, .user-query-container.edit-mode, [role="dialog"]`
  - sendButton: `.send-button.submit button, .update-button button`
- AI Studio:
  - userTurn: `.user-prompt-container, [data-turn-role="User"]`
  - assistantTurn: `.model-prompt-container, [data-turn-role="Model"]`
  - composer: `ms-prompt-box textarea[formcontrolname=promptText], ms-chunk-input textarea, textarea[aria-label]`
  - sidebar: `.gv-aistudio .gv-folder-container`
  - composerRoot: `ms-prompt-box`
  - sendButton: `ms-run-button > button`
- ChatGPT:
  - userTurn: `[data-user-message-bubble], [data-message-author-role="user"]:not(:has([data-user-message-bubble]))`
  - assistantTurn: `[data-chatgpt-selection-message-id]`
  - codeBlock: `[data-markdown-copy="code-block"]`
  - composer: `#prompt-textarea, [data-composer-markdown][contenteditable="true"]`
  - sidebar: `nav[aria-label], #stage-slideover-sidebar`
  - headerActions: `#conversation-header-actions`
  - scrollContainer: `[data-app-action-timeline-scroll]`
  - composerRoot: `form:has(#prompt-textarea, [data-composer-markdown])`
  - sendButton: `form:has(#prompt-textarea, [data-composer-markdown]) button[type="submit"]`
- Claude:
  - userTurn: `[data-testid="user-message"]`
  - assistantTurn: `.font-claude-message, [data-testid="assistant-message"]`
  - composer: `[data-testid="chat-input"][contenteditable="true"]`
  - sidebar: `nav[aria-label], [data-testid="menu-sidebar"], [data-testid="sidebar"]`
  - sidePanel: `iframe[src*="claudeusercontent.com"]`
  - scrollContainer: `[data-autoscroll-container="true"]`
  - composerRoot: `[data-composer-card-holder] > div`
  - sendButton: `[data-testid="chat-input-send"]`
- DeepSeek:
  - userTurn: `.ds-message:has(.ds-collapsible-text):not(:has(.ds-assistant-message-main-content, .ds-think-content))`
  - assistantTurn: `.ds-message:has(.ds-assistant-message-main-content, .ds-think-content)`
  - thinkingBlock: `.ds-think-content`
  - codeBlock: `.md-code-block`
  - composer: `textarea.ds-scroll-area`
  - sidebar: `div:not(.ds-scroll-area):has(> .ds-scroll-area a[href^="/a/chat/s/"])`
  - scrollContainer: `.ds-virtual-list.ds-scroll-area`
  - composerRoot: `div:has(> div > textarea.ds-scroll-area)`
  - sendButton: `div:has(> div > textarea.ds-scroll-area) div.ds-button--primary.ds-button--circle[role="button"]`
- Kimi:
  - userTurn: `.segment-user`
  - assistantTurn: `.segment-assistant`
  - thinkingBlock: `.segment-assistant .thinking-container`
  - composer: `.chat-input-editor[contenteditable="true"][role="textbox"]`
  - sidebar: `aside.next-sidebar`
  - scrollContainer: `div.chat-detail-main`
  - composerRoot: `.chat-editor-content`
  - sendButton: `.send-button-container:not(.disabled)`

## Example (for ChatGPT; use your create page’s "matches")

### A scripted plugin (a timer badge)

```json
{
  "id": "me.chat-timer",
  "name": "Conversation timer",
  "version": "1.0.0",
  "description": "Show how long the current conversation has been open",
  "author": "me",
  "category": "productivity",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "scripted",
  "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  "contributes": {
    "script": {
      "source": "// Conversation timer: a small badge with how long this conversation has been open.\nconst badge = document.createElement('div');\nbadge.className = 'gv-plugin-chat-timer';\nObject.assign(badge.style, {\n  position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',\n  padding: '4px 8px', borderRadius: '8px', font: '12px system-ui, sans-serif',\n  background: 'rgba(0, 0, 0, 0.6)', color: '#fff', pointerEvents: 'none',\n});\ndocument.body.append(badge);\n\nlet path = location.pathname;\nlet openedAt = Date.now();\n\nfunction render() {\n  // The site switches conversations without reloading, so watch the address.\n  if (location.pathname !== path) {\n    path = location.pathname;\n    openedAt = Date.now();\n  }\n  const minutes = Math.floor((Date.now() - openedAt) / 60000);\n  badge.textContent = `Open for ${minutes} min`;\n}\n\nrender();\nsetInterval(render, 1000);\n"
    }
  }
}
```

## Reply format

Exactly one ```json fenced code block with the complete manifest, as the create page says.
