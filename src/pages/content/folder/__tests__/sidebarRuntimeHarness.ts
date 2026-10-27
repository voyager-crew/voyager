import { vi } from 'vitest';

import { mountRealGeminiSidebar } from '@/core/gemini/sidebar/__tests__/realSidebarFixture';

import { FolderSidebarRuntime } from '../FolderSidebarRuntime';
import { NativeConversationMenus } from '../NativeConversationMenus';
import { NativeSidebarObserver } from '../NativeSidebarObserver';

export function setLayout(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => (width > 0 && height > 0 ? document.body : null),
  });
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  });
}

export function mountSidebar(rowCount = 0) {
  const fixture = mountRealGeminiSidebar(rowCount);
  setLayout(fixture.sidebar, 280, 800);
  return fixture;
}

export function createSidebarRuntimeHarness() {
  let runtime: FolderSidebarRuntime;
  let floatingPanelOpen = false;
  let fabOpen = false;
  const createPanel = vi.fn(() => {
    const panel = document.createElement('div');
    panel.className = 'gv-folder-container';
    setLayout(panel, 280, 200);
    return panel;
  });
  const onPanelMount = vi.fn();
  const onPanelUnmount = vi.fn();
  const floating = {
    isOpen: () => floatingPanelOpen,
    open: vi.fn(async (openPanel: boolean) => {
      floatingPanelOpen = openPanel;
      fabOpen = !openPanel;
    }),
    close: vi.fn(() => {
      floatingPanelOpen = false;
      fabOpen = false;
    }),
  };
  const nativeSidebar = new NativeSidebarObserver({
    isDestroyed: () => false,
    enhanceConversation: (row) => {
      row.draggable = true;
    },
    hasStoredConversations: () => false,
    onTitlesChanged: () => {},
  });
  const nativeMenus = new NativeConversationMenus({
    getContext: () => ({
      sidebar: runtime.sidebar,
      storageKey: 'gvFolderData',
      accountIsolationEnabled: false,
      isDestroyed: false,
    }),
    onMoveToFolder: () => {},
    onConfirmedDelete: () => {},
  });
  runtime = new FolderSidebarRuntime({
    createPanel,
    onPanelMount,
    onPanelUnmount,
    nativeSidebar,
    nativeMenus,
    floating,
  });
  return {
    runtime,
    createPanel,
    onPanelMount,
    onPanelUnmount,
    floating,
    hasFab: () => fabOpen,
    closeFloatingPanel: () => {
      floatingPanelOpen = false;
      fabOpen = runtime.isFloatingMode;
    },
  };
}
