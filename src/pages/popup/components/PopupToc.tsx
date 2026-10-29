import React from 'react';

import type { TranslationKey } from '@/utils/translations';

import { type PopupSectionId, popupSectionAnchorId } from '../hooks/usePopupSections';
import { OFFICIAL_PLUGIN_TOPICS } from '../officialPlugins/officialPluginRegistry';

/** Room left above a card scrolled to, below the sticky header. */
const SCROLL_GAP_PX = 12;

/** The cards the table of contents names, by their short name; any other section is left out. */
const TOC_LABELS: Readonly<Partial<Record<PopupSectionId, TranslationKey>>> = {
  cloudSync: 'cloudSync',
  ...Object.fromEntries(OFFICIAL_PLUGIN_TOPICS.map((topic) => [topic.id, topic.tocLabel])),
  localPlugins: 'localPluginsTitle',
  folder: 'folder_title',
  keyboardShortcuts: 'popupTocShortcuts',
  siteAccess: 'siteAccessTitle',
  promptManager: 'popupTocPrompts',
  general: 'popupTocGeneral',
};

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Bring a section's card to the top of the popup, just below the sticky
 * header, and move focus to its title so the keyboard continues from there.
 */
export function scrollToPopupSection(id: PopupSectionId, header: HTMLElement | null): void {
  const target = document.getElementById(popupSectionAnchorId(id));
  if (!target) return;
  // A card without a title (the collapsed Local plugins card) takes focus itself.
  const landing = target.querySelector<HTMLElement>('h2, h3') ?? target;
  if (!landing.hasAttribute('tabindex')) landing.setAttribute('tabindex', '-1');
  landing.focus({ preventScroll: true });
  target.style.scrollMarginTop = `${(header?.offsetHeight ?? 0) + SCROLL_GAP_PX}px`;
  target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** Fades the trailing edge, so a row that runs past it reads as scrollable. */
function trailingFade(dir: 'rtl' | undefined): React.CSSProperties {
  const mask = `linear-gradient(to ${dir === 'rtl' ? 'left' : 'right'}, #000 calc(100% - 28px), transparent)`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

export interface PopupTocProps {
  /** The sections on screen, in display order. */
  readonly sections: readonly PopupSectionId[];
  readonly dir?: 'rtl';
  readonly t: (key: TranslationKey) => string;
}

/** One row of plain links to the cards on screen, scrolled sideways when it overflows. */
export function PopupToc({ sections, dir, t }: PopupTocProps) {
  const items = sections.flatMap((id) => {
    const label = TOC_LABELS[id];
    return label ? [{ id, label: t(label) }] : [];
  });
  if (items.length === 0) return null;
  return (
    <nav
      aria-label={t('popupTocLabel')}
      dir={dir}
      style={trailingFade(dir)}
      className="-mx-5 mt-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex gap-4 py-1 whitespace-nowrap">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={(event) =>
                scrollToPopupSection(
                  item.id,
                  event.currentTarget.closest<HTMLElement>('[data-popup-header]'),
                )
              }
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
