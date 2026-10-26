/** Read-only Gemini sidebar queries that decide where the folder panel mounts. */
import { getBundledGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import { acceptsGeminiSidebarElement } from '@/core/gemini/sidebar/proof';
import {
  firstVisibleSidebar,
  geminiSidebarSelector,
  readGeminiSidebarElements,
  resolveGeminiSidebarOperation,
} from '@/core/gemini/sidebar/queries';
import {
  resolvePlacementOperation,
  resolvePlacementViewOperation,
} from '@/core/selectors/placement';

export type FolderAnchor = 'above-recents' | 'above-notebooks';
type SidebarKey = Parameters<typeof geminiSidebarSelector>[0];

function isNativeMountElement(element: HTMLElement): boolean {
  return (
    element !== document.body &&
    element !== document.documentElement &&
    !element.closest('.gv-folder-container, [data-gv-shadow-surface]') &&
    // Folder clicks must not bubble through a remotely matched native action or overlay.
    !element.closest('button, a[href], [role="button"], [role="menuitem"], [role="dialog"]')
  );
}

function readSidebar(view: GeminiSelectorView): HTMLElement | null {
  const candidates = readGeminiSidebarElements(document, 'sidebar.overflow', view);
  const sidebar = firstVisibleSidebar(
    view.remoteKeys.has('sidebar.overflow') ? candidates.filter(isNativeMountElement) : candidates,
  );
  if (
    sidebar &&
    view.remoteKeys.has('sidebar.overflow') &&
    !readAnchor(sidebar, 'above-recents', view) &&
    !readNotebooks(sidebar, view) &&
    !sidebar.querySelector(geminiSidebarSelector('sidebar.row', view))
  ) {
    return null;
  }
  if (sidebar && view.remoteKeys.has('sidebar.overflow')) {
    const original = readSidebar(getBundledGeminiSelectorView());
    if (!acceptsGeminiSidebarElement('sidebar.overflow', sidebar, original)) return null;
  }
  return sidebar;
}

export function findSidebar(): HTMLElement | null {
  return resolveGeminiSidebarOperation(readSidebar, (sidebar) => sidebar !== null).value;
}

function readNotebooks(sidebar: HTMLElement | null, view: GeminiSelectorView): HTMLElement | null {
  return resolvePlacementOperation(
    view,
    'sidebar.notebooks',
    (selector) => sidebar?.querySelector<HTMLElement>(selector) ?? null,
  );
}

export function findSidebarNotebooks(
  view?: GeminiSelectorView,
): { sidebar: HTMLElement; notebooks: HTMLElement } | null {
  return resolveGeminiSidebarOperation(
    (selected) => {
      const sidebar = readSidebar(selected);
      const notebooks = readNotebooks(sidebar, selected);
      return sidebar && notebooks ? { sidebar, notebooks } : null;
    },
    (location) => location !== null,
    view,
  ).value;
}

const SIDEBAR_PLACEMENT_KEYS = [
  'sidebar.notebooks',
  'sidebar.recents',
  'sidebar.allConversations',
  'sidebar.history',
  'sidebar.section',
  'sidebar.rowContainer',
] as const;

function readAnchor(
  sidebar: HTMLElement,
  preference: FolderAnchor,
  view: GeminiSelectorView,
): HTMLElement | null {
  const read = (selected: GeminiSelectorView): HTMLElement | null => {
    if (preference === 'above-notebooks') {
      const notebooks = sidebar.querySelector<HTMLElement>(
        geminiSidebarSelector('sidebar.notebooks', selected),
      );
      if (notebooks) return notebooks;
      if (selected.remoteKeys.has('sidebar.notebooks')) return null;
    }
    return readAnchorCandidate(sidebar, selected);
  };
  // These six keys only position our panel; the sidebar's data/identity proof stays separate.
  if (!SIDEBAR_PLACEMENT_KEYS.some((key) => view.remoteKeys.has(key))) return read(view);
  return resolvePlacementViewOperation(view, SIDEBAR_PLACEMENT_KEYS, (selected) =>
    read(selected as GeminiSelectorView),
  );
}

/** Preserve the original insertion priority, falling back as one placement operation. */
function readAnchorCandidate(sidebar: HTMLElement, view: GeminiSelectorView): HTMLElement | null {
  const select = (key: SidebarKey) =>
    sidebar.querySelector<HTMLElement>(geminiSidebarSelector(key, view));
  const section = geminiSidebarSelector('sidebar.section', view);
  const recents = select('sidebar.recents');
  if (recents) return recents;
  if (view.remoteKeys.has('sidebar.recents')) return null;
  for (const key of ['sidebar.allConversations', 'sidebar.history'] as const) {
    const element = select(key);
    if (element) {
      const ancestor = element.closest<HTMLElement>(section);
      return ancestor ?? (view.remoteKeys.has('sidebar.section') ? null : element);
    }
    if (view.remoteKeys.has(key)) return null;
  }
  const firstConversation = select('sidebar.row');
  const ancestor = firstConversation?.closest<HTMLElement>(section);
  if (ancestor) return ancestor;
  if (view.remoteKeys.has('sidebar.section')) return null;
  return (
    firstConversation?.closest<HTMLElement>(geminiSidebarSelector('sidebar.rowContainer', view)) ??
    null
  );
}

/** The entire mount is reread from the bundle if an online root has no usable anchor. */
export interface GeminiSidebarMount {
  sidebar: HTMLElement;
  anchor: HTMLElement;
  view: GeminiSelectorView;
}

export function findSidebarMount(preference: FolderAnchor): GeminiSidebarMount | null {
  const operation = resolveGeminiSidebarOperation(
    (view) => {
      const sidebar = readSidebar(view);
      const anchor = sidebar && readAnchor(sidebar, preference, view);
      return sidebar && anchor ? { sidebar, anchor } : null;
    },
    (mount) => mount !== null,
  );
  return operation.value ? { ...operation.value, view: operation.view } : null;
}

export function findSidebarVisibilityHost(): HTMLElement | null {
  return resolveGeminiSidebarOperation(
    (view) => {
      for (const selector of view.profiles['sidebar.visibilityHost']) {
        const host = document.querySelector(selector);
        if (!(host instanceof HTMLElement)) continue;
        if (!view.remoteKeys.has('sidebar.visibilityHost')) return host;
        const original =
          getBundledGeminiSelectorView()
            .profiles['sidebar.visibilityHost'].map((selector) =>
              document.querySelector<HTMLElement>(selector),
            )
            .find(Boolean) ?? null;
        if (acceptsGeminiSidebarElement('sidebar.visibilityHost', host, original)) return host;
      }
      return null;
    },
    (host) => host !== null,
  ).value;
}

export function isSidebarOpen(): boolean {
  return resolveGeminiSidebarOperation(
    (view) => {
      // One rejected state member must restore the whole bundled open/host read.
      let valid = true;
      const read = (key: 'sidebar.openHost' | 'sidebar.host') => {
        const candidate = document.querySelector<HTMLElement>(geminiSidebarSelector(key, view));
        if (!view.remoteKeys.has(key)) return candidate;
        const original = document.querySelector<HTMLElement>(
          geminiSidebarSelector(key, getBundledGeminiSelectorView()),
        );
        if (acceptsGeminiSidebarElement(key, candidate, original)) return candidate;
        valid = false;
        return null;
      };
      const open = read('sidebar.openHost');
      const sidebar = read('sidebar.host');
      return {
        found: valid && (open !== null || sidebar instanceof HTMLElement),
        open: open !== null || (sidebar instanceof HTMLElement && sidebar.offsetWidth > 120),
      };
    },
    (result) => result.found,
  ).value.open;
}

/** Gemini can clone a panel unknown to us. Remove only direct Gemini folder siblings. */
export function removeStrayFolderPanels(parent: HTMLElement): void {
  for (const sibling of Array.from(parent.children)) {
    if (
      sibling instanceof HTMLElement &&
      sibling.classList.contains('gv-folder-container') &&
      !sibling.classList.contains('gv-aistudio') &&
      !sibling.classList.contains('gv-multi-select-floating-host')
    ) {
      sibling.remove();
    }
  }
}
