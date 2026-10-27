import { getTranslationSyncUnsafe } from '@/utils/i18n';

import type { FolderAnchor } from './sidebarMountDom';

interface NotebooksAnchorToggleOptions {
  getPreference: () => FolderAnchor;
  /** Flip and persist the preference; called after the event is consumed. */
  onToggle: () => void;
}

const ANCHOR_HOST_CLASS = 'gv-folders-anchor-host';

/** Owns the button on Gemini's Notebooks section that moves the folder panel above or below it. */
export class NotebooksAnchorToggle {
  private button: HTMLElement | null = null;

  constructor(private readonly options: NotebooksAnchorToggleOptions) {}

  /** Attach the button to `notebooks`, reusing it when it is already there. */
  ensure(notebooks: HTMLElement | null): void {
    if (!notebooks) {
      if (this.button && !this.button.isConnected) this.button = null;
      return;
    }
    if (this.button?.parentElement === notebooks) {
      this.refreshLanguage();
      return;
    }
    this.button?.remove();
    notebooks.classList.add(ANCHOR_HOST_CLASS);
    const button = document.createElement('span');
    button.className = 'gv-folders-anchor-toggle';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M320-440v-287L217-624l-57-56 200-200 200 200-57 56-103-103v287h-80Zm320 280L440-360l57-56 103 103v-287h80v287l103-103 57 56-200 200Z"/></svg>`;
    const toggle = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      event.stopPropagation();
      event.preventDefault();
      this.options.onToggle();
    };
    button.addEventListener('click', toggle);
    button.addEventListener('keydown', toggle);
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('mousedown', (event) => event.stopPropagation());
    notebooks.appendChild(button);
    this.button = button;
    this.refreshLanguage();
  }

  cleanup(): void {
    this.button?.remove();
    this.button = null;
    document
      .querySelectorAll(`.${ANCHOR_HOST_CLASS}`)
      .forEach((element) => element.classList.remove(ANCHOR_HOST_CLASS));
  }

  refreshLanguage(): void {
    const button = this.button;
    if (!button) return;
    const aboveNotebooks = this.options.getPreference() === 'above-notebooks';
    const label = getTranslationSyncUnsafe(
      aboveNotebooks ? 'folder_anchor_move_above_recents' : 'folder_anchor_move_above_notebooks',
    );
    button.title = label;
    button.setAttribute('aria-label', label);
    button.classList.toggle('gv-anchor-above-notebooks', aboveNotebooks);
  }
}
