import { GEMINI_PACKAGED_FORK } from '@/core/gemini/content/packaged';
import { askConfirm } from '@/core/ui/confirm';

import { getTranslationSync } from '../../../utils/i18n';
import { collectForkChatPairs } from './chatPairs';

const STYLE_ID = 'gemini-voyager-fork-style';
const FORK_BTN_CLASS = 'gv-fork-btn';
const FORK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/></svg>`;

/**
 * Fork runs on this page that rely on the shared stylesheet. A run that stops
 * late, after its replacement started, must leave the sheet to the newer run.
 */
let styleUsers = 0;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.gv-fork-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  color: var(--gv-fork-btn-color, #5f6368);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.15s,
    transform 0.15s,
    background-color 0.15s;
  position: absolute;
  top: 9px;
  right: calc(100% + 8px);
  z-index: 1;
  white-space: nowrap;
  height: 22px;
  box-sizing: border-box;
}
.gv-fork-btn:hover {
  opacity: 1;
  background-color: var(--gv-fork-btn-hover-bg, rgba(0, 0, 0, 0.06));
}
.gv-fork-btn svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

/* Reveal on hover/focus without affecting message layout */
.user-query-bubble-with-background:hover .gv-fork-btn,
.user-query-container:hover .gv-fork-btn,
user-query:hover .gv-fork-btn,
user-query-content:hover .gv-fork-btn,
.user-query-bubble-with-background:focus-within .gv-fork-btn,
.user-query-container:focus-within .gv-fork-btn,
user-query:focus-within .gv-fork-btn,
user-query-content:focus-within .gv-fork-btn,
.gv-fork-btn:hover,
.gv-fork-btn:focus-visible {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

html[dir='rtl'] .gv-fork-btn,
body[dir='rtl'] .gv-fork-btn,
body.gv-rtl .gv-fork-btn {
  right: auto;
  left: calc(100% + 8px);
}

/* Fork branch indicator group */
.gv-fork-indicator-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  vertical-align: middle;
}
.gv-fork-indicator-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.gv-fork-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  background: var(--gv-fork-indicator-bg, rgba(26, 115, 232, 0.06));
  color: var(--gv-fork-indicator-color, #1a73e8);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  border: 1px solid var(--gv-fork-indicator-border, rgba(26, 115, 232, 0.28));
  transition:
    background-color 0.15s,
    color 0.15s,
    border-color 0.15s;
}
.gv-fork-indicator:hover {
  background: var(--gv-fork-indicator-hover-bg, rgba(26, 115, 232, 0.16));
}
.gv-fork-indicator.gv-current {
  background: var(--gv-fork-indicator-current-bg, #1a73e8);
  color: var(--gv-fork-indicator-current-color, #fff);
  border-color: var(--gv-fork-indicator-current-bg, #1a73e8);
  cursor: default;
}
.gv-fork-indicator-delete {
  position: absolute;
  top: -5px;
  right: -5px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid transparent;
  background: #ea4335;
  color: #fff;
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  opacity: 0;
  pointer-events: none;
  transform: scale(0.8);
  transition:
    opacity 0.15s,
    transform 0.15s;
}
.gv-fork-indicator-item:hover .gv-fork-indicator-delete,
.gv-fork-indicator-item:focus-within .gv-fork-indicator-delete {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1);
}
.gv-fork-indicator-delete:disabled {
  opacity: 0.6;
  cursor: default;
  pointer-events: none;
}

/* Dark mode */
html[dark] .gv-fork-btn,
body.dark-theme .gv-fork-btn {
  --gv-fork-btn-color: #9aa0a6;
  --gv-fork-btn-hover-bg: rgba(255, 255, 255, 0.08);
}
html[dark] .gv-fork-indicator,
body.dark-theme .gv-fork-indicator {
  --gv-fork-indicator-bg: rgba(138, 180, 248, 0.12);
  --gv-fork-indicator-color: #8ab4f8;
  --gv-fork-indicator-border: rgba(138, 180, 248, 0.28);
  --gv-fork-indicator-hover-bg: rgba(138, 180, 248, 0.2);
  --gv-fork-indicator-current-bg: #8ab4f8;
  --gv-fork-indicator-current-color: #202124;
}
html[dark] .gv-fork-indicator-delete,
body.dark-theme .gv-fork-indicator-delete {
  background: #f28b82;
  color: #202124;
}
`;
  document.head.appendChild(style);
}

function findUserCopyButtonAnchor(userEl: HTMLElement): HTMLElement | null {
  const copyButton =
    userEl.querySelector<HTMLElement>(GEMINI_PACKAGED_FORK['fork.copyButton'].join(',')) ||
    userEl
      .querySelector<HTMLElement>(GEMINI_PACKAGED_FORK['fork.copyIcon'].join(','))
      ?.closest<HTMLElement>('button');

  if (!copyButton) return null;
  return copyButton.parentElement || copyButton;
}

export function createForkControls({
  ensureTurnId,
  resolveUserMessageHost,
  getConversationId,
  onFork,
}: {
  ensureTurnId: (element: HTMLElement, index: number) => string;
  getConversationId: () => string | null;
  resolveUserMessageHost: (element: HTMLElement) => HTMLElement;
  onFork: (element: HTMLElement, index: number, mode: 'paste' | 'fileUpload') => Promise<void>;
}) {
  function resolveForkButtonHost(userEl: HTMLElement): HTMLElement {
    return findUserCopyButtonAnchor(userEl) || resolveUserMessageHost(userEl);
  }

  injectStyles();
  styleUsers += 1;
  const lifetime = new AbortController();
  /** Buttons this run created: its stop removes these, never a newer run's. */
  const ownButtons = new Set<HTMLElement>();

  function injectForkButtons(): void {
    const pairs = collectForkChatPairs();

    pairs.forEach((pair, index) => {
      const userEl = pair.userElement;
      ensureTurnId(userEl, index);
      const hostEl = resolveForkButtonHost(userEl);

      const existingButton = userEl.querySelector<HTMLElement>(`.${FORK_BTN_CLASS}`);
      if (existingButton) {
        hostEl.style.position = hostEl.style.position || 'relative';
        if (existingButton.parentElement !== hostEl) {
          hostEl.appendChild(existingButton);
        }
        return;
      }

      const btn = document.createElement('button');
      btn.className = FORK_BTN_CLASS;
      btn.title = getTranslationSync('forkConversation');
      btn.innerHTML = `${FORK_ICON}<span>${getTranslationSync('forkConversation')}</span>`;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        void showForkConfirmation(btn, userEl, index);
      });

      // Add at the end of the user message container
      hostEl.style.position = hostEl.style.position || 'relative';
      hostEl.appendChild(btn);
      ownButtons.add(btn);
    });
  }

  async function showForkConfirmation(
    btn: HTMLElement,
    userEl: HTMLElement,
    turnIndex: number,
  ): Promise<void> {
    const conversationAtAsk = getConversationId();
    const mode = await askConfirm<'paste' | 'fileUpload'>({
      message: getTranslationSync('forkConfirm'),
      anchor: btn,
      side: 'above',
      tone: 'neutral',
      choices: [
        { id: 'fileUpload', label: getTranslationSync('forkMarkdownBtn'), emphasis: 'secondary' },
        { id: 'paste', label: getTranslationSync('forkConfirmBtn') },
      ],
      signal: lifetime.signal,
    });
    // The page may have moved to another conversation while the confirm was open.
    if (!mode || !userEl.isConnected || getConversationId() !== conversationAtAsk) return;
    await onFork(userEl, turnIndex, mode);
  }

  function updateForkButtonTexts(): void {
    const buttons = document.querySelectorAll<HTMLElement>(`.${FORK_BTN_CLASS}`);
    buttons.forEach((btn) => {
      btn.title = getTranslationSync('forkConversation');
      const span = btn.querySelector('span');
      if (span) span.textContent = getTranslationSync('forkConversation');
    });
  }
  return {
    inject: injectForkButtons,
    updateLanguage: updateForkButtonTexts,
    stop() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      for (const button of ownButtons) button.remove();
      ownButtons.clear();
      styleUsers -= 1;
      if (styleUsers === 0) document.getElementById(STYLE_ID)?.remove();
    },
  };
}
