/** The official AI Studio plugin owns layout only; folder data and UI remain native. */
import browser from 'webextension-polyfill';

import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { normalizeAIStudioSidebarWidth } from '@/core/utils/aistudioSidebarWidthValues';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import type { PluginSettings } from '@/features/plugins/types';
import { aistudioPackagedSelector } from '@/pages/content/folder/aistudioLocatorReads';

const NAV_SELECTOR = aistudioPackagedSelector('navigation.sidebar');
const WIDTH_PROPERTIES = [
  'width',
  'min-width',
  'max-width',
  'flex',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
];
interface WidthRun {
  update(settings: PluginSettings): void;
}
const runs = new Set<WidthRun>();

function restoreProperties(style: CSSStyleDeclaration, properties: readonly string[]): () => void {
  const previous = properties.map((property) => [
    property,
    style.getPropertyValue(property),
    style.getPropertyPriority(property),
  ]);
  return () => {
    for (const [property, value, priority] of previous) {
      if (value) style.setProperty(property, value, priority);
      else style.removeProperty(property);
    }
  };
}

async function saveWidth(width: number): Promise<void> {
  try {
    localStorage.setItem(StorageKeys.AISTUDIO_SIDEBAR_WIDTH, String(width));
  } catch {
    // The sync copy still works when page storage is unavailable.
  }
  try {
    if (browser.runtime?.id || chrome.runtime?.id) {
      await browser.storage.sync.set({ [StorageKeys.AISTUDIO_SIDEBAR_WIDTH]: width });
    }
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('Failed to save AI Studio sidebar width', { error });
    }
  }
}

export function activateAIStudioSidebarWidth(scope: PluginScope, settings: PluginSettings): void {
  let width = normalizeAIStudioSidebarWidth(settings.widthPx);
  let mounted: {
    nav: HTMLElement;
    handle: HTMLElement;
    stop(): void;
    apply(force?: boolean): void;
  } | null = null;

  const mount = (nav: HTMLElement): NonNullable<typeof mounted> => {
    const navScope = new PluginScope();
    const restoreWidth = restoreProperties(nav.style, WIDTH_PROPERTIES);
    const restorePosition = restoreProperties(nav.style, ['position']);
    const handle = createHandle();
    let dragging = false;
    let startX = 0;
    let startWidth = width;
    let restoreBody: (() => void) | null = null;
    const finishDrag = () => {
      dragging = false;
      restoreBody?.();
      restoreBody = null;
    };
    const apply = (force = false) => {
      if (scope.isDisposed || navScope.isDisposed) return;
      const expanded = nav.matches(aistudioPackagedSelector('navigation.expanded'));
      handle.style.display = expanded ? 'block' : 'none';
      if (expanded || force) {
        const px = `${width}px`;
        nav.style.width = px;
        nav.style.minWidth = px;
        nav.style.maxWidth = px;
        nav.style.flex = `0 0 ${px}`;
      } else restoreWidth();
    };
    // Abort restores synchronously, even if another scope disposer is still pending.
    const restore = () => {
      finishDrag();
      handle.remove();
      restoreWidth();
      restorePosition();
    };
    navScope.effect(() => {
      nav.style.position = 'relative';
      nav.appendChild(handle);
      navScope.signal.addEventListener('abort', restore, { once: true });
      return () => navScope.signal.removeEventListener('abort', restore);
    }, 'aistudio-sidebar-width:nav');
    navScope.on(handle, 'mousedown', (event) => {
      if (scope.isDisposed || navScope.isDisposed) return;
      finishDrag();
      dragging = true;
      startX = event.clientX;
      startWidth = width;
      restoreBody = restoreProperties(document.body.style, ['cursor', 'user-select']);
      event.preventDefault();
      event.stopPropagation();
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    });
    navScope.on(document, 'mousemove', (event) => {
      if (!dragging || scope.isDisposed || navScope.isDisposed) return;
      width = normalizeAIStudioSidebarWidth(startWidth + event.clientX - startX);
      apply(true);
    });
    navScope.on(document, 'mouseup', () => {
      if (!dragging || scope.isDisposed || navScope.isDisposed) return;
      finishDrag();
      void saveWidth(width);
    });
    navScope.on(handle, 'mouseenter', () => {
      handle.style.backgroundColor = 'rgba(66, 133, 244, 0.5)';
    });
    navScope.on(handle, 'mouseleave', () => {
      handle.style.backgroundColor = 'transparent';
    });
    navScope.observe(nav, { attributes: true, attributeFilter: ['class'] }, () => apply());
    const release = scope.effect(
      () => () => navScope.dispose(),
      'aistudio-sidebar-width:mounted-nav',
    );
    apply(true);
    return {
      nav,
      handle,
      apply,
      stop: () => {
        void navScope.dispose();
        void release();
      },
    };
  };

  const reconcile = () => {
    if (scope.isDisposed) return;
    const nav = document.querySelector<HTMLElement>(NAV_SELECTOR);
    if (mounted?.nav === nav && mounted?.handle.isConnected) return;
    mounted?.stop();
    mounted = nav ? mount(nav) : null;
  };
  const stop = () => {
    mounted?.stop();
    mounted = null;
  };
  scope.effect(() => {
    scope.signal.addEventListener('abort', stop, { once: true });
    reconcile();
    return () => {
      stop();
      scope.signal.removeEventListener('abort', stop);
    };
  }, 'aistudio-sidebar-width:layout');
  const affectsLayout = (node: Node): boolean => {
    if (mounted && (node.contains(mounted.nav) || node.contains(mounted.handle))) return true;
    return (
      node instanceof Element &&
      (node.matches(NAV_SELECTOR) || node.querySelector(NAV_SELECTOR) !== null)
    );
  };
  scope.observe(document.documentElement, { childList: true, subtree: true }, (records) => {
    // Chat streaming must not rescan the document; nav/ancestor rebuilds still need remounting.
    if (
      records.some(
        (record) =>
          Array.from(record.addedNodes).some(affectsLayout) ||
          Array.from(record.removedNodes).some(affectsLayout),
      )
    ) {
      reconcile();
    }
  });
  const run: WidthRun = {
    update(next) {
      if (scope.isDisposed || typeof next.widthPx !== 'number') return;
      width = normalizeAIStudioSidebarWidth(next.widthPx);
      mounted?.apply();
    },
  };
  scope.effect(() => {
    runs.add(run);
    return () => {
      runs.delete(run);
    };
  }, 'aistudio-sidebar-width:settings');
}

export function updateAIStudioSidebarWidthSettings(settings: PluginSettings): void {
  for (const run of runs) run.update(settings);
}

function createHandle(): HTMLElement {
  const handle = document.createElement('div');
  handle.className = 'gv-sidebar-resize-handle';
  handle.title = 'Drag to resize sidebar';
  Object.assign(handle.style, {
    position: 'absolute',
    top: '0',
    right: '-4px',
    width: '8px',
    height: '100%',
    cursor: 'ew-resize',
    zIndex: '10000',
    backgroundColor: 'transparent',
    transition: 'background-color 0.2s',
    pointerEvents: 'auto',
  });
  return handle;
}
