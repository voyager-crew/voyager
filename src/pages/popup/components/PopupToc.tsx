import type { TranslationKey } from '@/utils/translations';

import { type PopupSectionId, popupSectionAnchorId } from '../hooks/usePopupSections';
import { prefersReducedMotion, usePopupTocBar } from '../hooks/usePopupTocBar';
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

/**
 * Bring a section's card to the top of the popup, just below the sticky
 * header, and move focus to its title, or to the field `focusId` names inside
 * it, so the keyboard continues from there.
 */
export function scrollToPopupSection(
  id: PopupSectionId,
  header: HTMLElement | null,
  focusId?: string,
): void {
  const target = document.getElementById(popupSectionAnchorId(id));
  if (!target) return;
  const named = focusId ? document.getElementById(focusId) : null;
  const field = named && target.contains(named) ? named : null;
  // A card without a title takes focus itself.
  const landing = field ?? target.querySelector<HTMLElement>('h2, h3') ?? target;
  if (!field && !landing.hasAttribute('tabindex')) landing.setAttribute('tabindex', '-1');
  landing.focus({ preventScroll: true });
  target.style.scrollMarginTop = `${(header?.offsetHeight ?? 0) + SCROLL_GAP_PX}px`;
  target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

const ARROW_CLASS =
  'text-foreground absolute inset-y-0 z-10 flex w-11 items-center from-background via-background/90 to-transparent';
const ARROW_FACE_CLASS =
  'bg-background border-border/70 hover:bg-accent grid h-5 w-5 place-items-center rounded-full border shadow-sm transition-colors';

function Chevron({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={side === 'left' ? 'M10 3 5 8l5 5' : 'm6 3 5 5-5 5'} />
    </svg>
  );
}

/**
 * Pages the bar for a mouse. Keyboard users reach every link with Tab, which
 * scrolls it into view, so the arrows stay out of the tab order and the tree.
 */
function PageArrow({ side, onPage }: { side: 'left' | 'right'; onPage: () => void }) {
  const placement =
    side === 'left'
      ? 'left-0 justify-start pl-1.5 bg-linear-to-r'
      : 'right-0 justify-end pr-1.5 bg-linear-to-l';
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      data-page-arrow={side}
      onClick={onPage}
      className={`${ARROW_CLASS} ${placement}`}
    >
      <span className={ARROW_FACE_CLASS}>
        <Chevron side={side} />
      </span>
    </button>
  );
}

export interface PopupTocProps {
  /** The sections on screen, in display order. */
  readonly sections: readonly PopupSectionId[];
  readonly dir?: 'rtl';
  readonly t: (key: TranslationKey) => string;
}

/**
 * One row of plain links to the cards on screen. When it runs past the popup's
 * width it pages with the arrows or the wheel, and marks the card being read.
 */
export function PopupToc({ sections, dir, t }: PopupTocProps) {
  const items = sections.flatMap((id) => {
    const label = TOC_LABELS[id];
    return label ? [{ id, label: t(label) }] : [];
  });
  const { navRef, sides, current, page, pick } = usePopupTocBar(sections, dir === 'rtl');
  if (items.length === 0) return null;
  return (
    <div className="relative -mx-5 mt-2">
      <nav
        ref={navRef}
        aria-label={t('popupTocLabel')}
        dir={dir}
        className="overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex w-max gap-4 py-1 whitespace-nowrap">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-toc-section={item.id}
                aria-current={current === item.id ? 'location' : undefined}
                onClick={(event) => {
                  pick(item.id);
                  scrollToPopupSection(
                    item.id,
                    event.currentTarget.closest<HTMLElement>('[data-popup-header]'),
                  );
                }}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring aria-[current=location]:text-primary rounded-sm text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {sides.left && <PageArrow side="left" onPage={() => page('left')} />}
      {sides.right && <PageArrow side="right" onPage={() => page('right')} />}
    </div>
  );
}
