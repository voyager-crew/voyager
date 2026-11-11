import type { CSSProperties } from 'react';

import type { TranslationKey } from '@/utils/translations';

import { CREATE_REQUEST_INPUT_ID } from '../hooks/useCreateRequest';
import type { usePopupSections } from '../hooks/usePopupSections';
import { isOfficialPluginTopicId } from '../utils/nativeSiteCapabilities';
import { scrollToPopupSection } from './PopupToc';

/** The quiet way from a plugin list to the Create card: scrolls to it and focuses its field. */
export function CreateYourOwnLine({
  t,
  style,
  dir,
}: {
  t: (key: TranslationKey) => string;
  style?: CSSProperties;
  dir?: 'rtl';
}) {
  return (
    <p style={style} dir={dir} className="text-muted-foreground text-center text-xs">
      {t('createModeCtaLead')}{' '}
      <button
        type="button"
        onClick={(event) =>
          scrollToPopupSection(
            'localPlugins',
            event.currentTarget.ownerDocument.querySelector<HTMLElement>('[data-popup-header]'),
            CREATE_REQUEST_INPUT_ID,
          )
        }
        className="text-primary focus-visible:ring-ring rounded-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        {t('createModeCtaAction')}
      </button>
    </p>
  );
}

/**
 * The same line on Gemini and AI Studio, right after whichever official topic
 * card shows last, wherever the user moved it. Hidden while the Create card
 * itself is off screen (a search that leaves it out).
 */
export function TopicCardsCreateLine({
  sections,
  dir,
  t,
}: {
  sections: Pick<ReturnType<typeof usePopupSections>, 'displayedSections' | 'getSectionProps'>;
  dir?: 'rtl';
  t: (key: TranslationKey) => string;
}) {
  const lastTopic = sections.displayedSections.filter(isOfficialPluginTopicId).at(-1);
  if (!lastTopic || !sections.displayedSections.includes('localPlugins')) return null;
  return (
    <CreateYourOwnLine
      t={t}
      dir={dir}
      style={{ order: sections.getSectionProps(lastTopic).order + 1 }}
    />
  );
}
