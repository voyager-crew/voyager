/**
 * Adds an "Export" item to Gemini's conversation (top bar / sidebar) and
 * response "⋮" menus whenever one opens.
 *
 * Gemini renders menu panels asynchronously and recycles them, so a panel is
 * retried a few times until its items exist, both from DOM mutations and from
 * the trigger's `aria-controls` link on click/pointerdown.
 */
import {
  getConversationMenuContext,
  getResponseMenuContext,
  injectConversationMenuExportButton,
  injectResponseMenuExportButton,
  removeExportMenuItems,
} from './conversationMenuInjection';
import { createMenuTaskQueue } from './menuLifetime';
import { collectMenuPanels, getMenuPanels, isMenuPanel } from './menuTargets';

const CONVERSATION_MENU_TRIGGER_TEST_IDS = [
  'actions-menu-button',
  'conversation-actions-menu-icon-button',
];
const RESPONSE_MENU_TRIGGER_TEST_ID = 'more-menu-button';
const MENU_INJECTION_RETRY_LIMIT = 8;
const MENU_INJECTION_RETRY_DELAY_MS = 80;

export type ConversationMenuExportRequest = {
  menuType: 'top' | 'sidebar' | 'message';
  trigger: HTMLElement | null;
};

export interface ConversationMenuExportOptions {
  /** Label and tooltip of the injected item, read each time a menu opens. */
  label: () => string;
  onExport: (request: ConversationMenuExportRequest) => void;
}

let stopActiveWatcher: (() => void) | null = null;

function parseMenuTriggerPanelIds(trigger: HTMLElement): string[] {
  const raw = `${trigger.getAttribute('aria-controls') || ''} ${
    trigger.getAttribute('aria-owns') || ''
  }`;
  return raw
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Start watching for export-capable menus. Page-wide and idempotent: while a
 * watcher runs, later calls are ignored. The watcher stops on `beforeunload`
 * or when the returned function is called; stopping also removes the items
 * from menus still open, and retries already scheduled inject nothing.
 */
export function watchConversationMenusForExport(
  options: ConversationMenuExportOptions,
): () => void {
  if (stopActiveWatcher) return () => {};

  const { label: readLabel, onExport } = options;
  let stopped = false;
  const tasks = createMenuTaskQueue();
  const later = tasks.schedule;

  const tryInjectOnPanel = (
    menuPanel: HTMLElement,
    retriesLeft: number = MENU_INJECTION_RETRY_LIMIT,
  ) => {
    if (stopped || !menuPanel.isConnected) return;
    const label = readLabel();
    const tooltip = readLabel();

    const menuContext = getConversationMenuContext(menuPanel);
    if (menuContext) {
      const injected = injectConversationMenuExportButton(menuPanel, {
        label,
        tooltip,
        onClick: () => onExport(menuContext),
      });
      if (!injected && retriesLeft > 0) {
        later(() => tryInjectOnPanel(menuPanel, retriesLeft - 1), MENU_INJECTION_RETRY_DELAY_MS);
      }
      return;
    }

    const responseMenuContext = getResponseMenuContext(menuPanel);
    if (responseMenuContext) {
      const injected = injectResponseMenuExportButton(menuPanel, {
        label,
        tooltip,
        onClick: () =>
          onExport({
            menuType: 'message',
            trigger: responseMenuContext.trigger,
          }),
      });
      if (!injected && retriesLeft > 0) {
        later(() => tryInjectOnPanel(menuPanel, retriesLeft - 1), MENU_INJECTION_RETRY_DELAY_MS);
      }
      return;
    }

    if (retriesLeft > 0) {
      later(() => tryInjectOnPanel(menuPanel, retriesLeft - 1), MENU_INJECTION_RETRY_DELAY_MS);
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const panelSet = collectMenuPanels(node);
        panelSet.forEach((panel) => {
          later(() => tryInjectOnPanel(panel), 30);
        });
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  const existingPanels = getMenuPanels();
  existingPanels.forEach((panel) => later(() => tryInjectOnPanel(panel), 30));

  const triggerSelector = [...CONVERSATION_MENU_TRIGGER_TEST_IDS, RESPONSE_MENU_TRIGGER_TEST_ID]
    .map((id) => `[data-test-id="${id}"]`)
    .join(', ');
  const onMenuTriggerInteraction = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const trigger = target.closest(triggerSelector) as HTMLElement | null;
    if (!trigger) return;

    const panelIds = parseMenuTriggerPanelIds(trigger);
    if (panelIds.length === 0) return;

    for (let attempt = 0; attempt <= MENU_INJECTION_RETRY_LIMIT; attempt++) {
      later(() => {
        panelIds.forEach((id) => {
          const panel = document.getElementById(id);
          if (!(panel instanceof HTMLElement)) return;
          if (!isMenuPanel(panel)) return;
          tryInjectOnPanel(panel);
        });
      }, attempt * MENU_INJECTION_RETRY_DELAY_MS);
    }
  };

  document.addEventListener('click', onMenuTriggerInteraction, true);
  document.addEventListener('pointerdown', onMenuTriggerInteraction, true);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('beforeunload', stop);
    tasks.stop();
    removeExportMenuItems();
    try {
      observer.disconnect();
    } catch {}
    try {
      document.removeEventListener('click', onMenuTriggerInteraction, true);
    } catch {}
    try {
      document.removeEventListener('pointerdown', onMenuTriggerInteraction, true);
    } catch {}
    if (stopActiveWatcher === stop) stopActiveWatcher = null;
  };
  stopActiveWatcher = stop;
  window.addEventListener('beforeunload', stop, { once: true });
  return stop;
}
