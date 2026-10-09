/**
 * Shared fixtures for the floating panel tests. Every query goes through
 * `panelRoot`, so a change of where the panel renders its content (light DOM
 * or a shadow root) touches this helper only.
 */

import { FOLDER_SITE_POLICIES } from '@/features/folder/owner/folderOwnerPolicy';

import {
  FLOATING_PANEL_CLASS,
  type FloatingPanelHandle,
  type FloatingPanelMountArgs,
  mountFloatingPanel,
} from '../floatingPanel';
import type { ConversationReference, Folder, FolderData } from '../types';

export { FLOATING_PANEL_CLASS };

const mountedHandles: FloatingPanelHandle[] = [];

/** What Gemini's floating panel is mounted with. */
export const GEMINI_PANEL = {
  policy: FOLDER_SITE_POLICIES.gemini,
  cloudActions: true,
  hintKeys: ['floatingPanelMoveHint', 'floatingPanelGestureHint'],
} as const;

export function createFolder(
  id: string,
  name: string,
  parentId: string | null,
  sortIndex: number,
  overrides: Partial<Folder> = {},
): Folder {
  return {
    id,
    name,
    parentId,
    isExpanded: true,
    sortIndex,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function createConversation(
  conversationId: string,
  title: string,
  overrides: Partial<ConversationReference> = {},
): ConversationReference {
  return {
    conversationId,
    title,
    url: `https://gemini.google.com/app/${conversationId}`,
    addedAt: 1,
    ...overrides,
  };
}

export function createData(): FolderData {
  return {
    folders: [
      createFolder('folder-a', 'Alpha', null, 0),
      createFolder('folder-b', 'Beta', null, 1),
    ],
    folderContents: {
      'folder-a': [createConversation('conv-a', 'Conversation A', { starred: true })],
      'folder-b': [],
    },
  };
}

export function mountPanel(args: Partial<FloatingPanelMountArgs> = {}): FloatingPanelHandle {
  const handle = mountFloatingPanel({ ...GEMINI_PANEL, ...args, data: args.data ?? createData() });
  mountedHandles.push(handle);
  return handle;
}

export function destroyMountedPanels(): void {
  for (const handle of mountedHandles.splice(0)) handle.destroy();
}

/** Where the panel renders its content. */
export function panelRoot(
  handle: FloatingPanelHandle,
): ParentNode & { textContent: string | null } {
  return handle.element.shadowRoot!;
}

export function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Expected element for selector: ${selector}`);
  return element;
}

export function part<T extends Element = HTMLElement>(
  handle: FloatingPanelHandle,
  suffix: string,
): T {
  return requireElement<T>(panelRoot(handle), `.${FLOATING_PANEL_CLASS}__${suffix}`);
}

export function queryPart(handle: FloatingPanelHandle, suffix: string): Element | null {
  return panelRoot(handle).querySelector(`.${FLOATING_PANEL_CLASS}__${suffix}`);
}

export function folderHeader(root: ParentNode, folderId: string): HTMLElement {
  return requireElement<HTMLElement>(
    root,
    `.${FLOATING_PANEL_CLASS}__folder-header[data-folder-id="${folderId}"]`,
  );
}

export function keydown(element: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  element.dispatchEvent(event);
  return event;
}

export function click(element: Element): void {
  element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
}

export function mousedown(element: Element): MouseEvent {
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
  element.dispatchEvent(event);
  return event;
}

export function dblclick(element: Element): void {
  element.dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true }),
  );
}

export function contextMenu(element: Element): void {
  element.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 24,
      clientY: 32,
    }),
  );
}

export function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  const transfer = {
    dropEffect: 'none' as DataTransfer['dropEffect'],
    effectAllowed: 'uninitialized' as DataTransfer['effectAllowed'],
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    // Browsers expose `types` as a live view of stored MIME keys. The mock
    // regenerates it on read so dragover checks (which can't read values
    // for security) still observe what setData put in.
    get types(): readonly string[] {
      return Array.from(store.keys());
    },
    clearData: (format?: string) => {
      if (format) store.delete(format);
      else store.clear();
    },
    getData: (format: string) => store.get(format) ?? '',
    setData: (format: string, value: string) => {
      store.set(format, value);
    },
    setDragImage: () => {},
  };
  return transfer as unknown as DataTransfer;
}

export function createDragEvent(type: string, dataTransfer: DataTransfer): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true, composed: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

export function pointerEvent(type: string, init: MouseEventInit): Event {
  // jsdom has no PointerEvent constructor; MouseEvent carries everything the
  // drag handlers read (button, clientX/Y).
  return new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
}

export function stubPointerCapture(element: HTMLElement): void {
  Object.assign(element, { setPointerCapture: () => {}, releasePointerCapture: () => {} });
}

export function setWindowSize(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

export function setElementRect(element: HTMLElement, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

export function installResizeObserverMock(): { emit: () => void } {
  let callback: ResizeObserverCallback | null = null;
  class MockResizeObserver implements ResizeObserver {
    constructor(nextCallback: ResizeObserverCallback) {
      callback = nextCallback;
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = MockResizeObserver;
  return { emit: () => callback?.([], {} as ResizeObserver) };
}
