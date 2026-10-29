import { useState } from 'react';

import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { isRTLLanguage } from '@/core/utils/rtl';
import type { TranslationKey } from '@/utils/translations';

import { COVERAGE_REFUSAL_MESSAGES } from '../hooks/useCustomWebsites';
import type { ActiveSitePrompt } from '../hooks/useSiteAccess';

const SWITCH_ID = 'prompt-manager-site-enabled';
const HINT_ID = 'prompt-manager-site-hint';

/**
 * Prompt Manager as the first row of the open site's feature list, boxed like
 * the plugin rows under it. Its switch is the site's coverage entry.
 */
export function PromptManagerSiteRow({
  prompt,
  t,
}: {
  prompt: ActiveSitePrompt;
  t: (key: TranslationKey) => string;
}) {
  const { language } = useLanguage();
  const [refusal, setRefusal] = useState<TranslationKey | null>(null);
  return (
    // The popup sets no direction, so the row mirrors itself for RTL languages.
    <div
      dir={isRTLLanguage(language) ? 'rtl' : undefined}
      className="border-border/60 rounded-lg border p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={SWITCH_ID} className="cursor-pointer text-sm leading-snug font-medium">
            {t('promptManagerOptions')}
          </label>
          <p id={HINT_ID} className="text-muted-foreground mt-0.5 text-xs leading-snug">
            {t('enablePromptManagerOnSiteHint')}
          </p>
          {refusal && <p className="text-destructive mt-1 text-[11px]">{t(refusal)}</p>}
        </div>
        <Switch
          id={SWITCH_ID}
          checked={prompt.enabled}
          aria-describedby={HINT_ID}
          onChange={(event) => {
            setRefusal(null);
            void prompt.setEnabled(event.target.checked).then((reason) => {
              if (reason) setRefusal(COVERAGE_REFUSAL_MESSAGES[reason]);
            });
          }}
        />
      </div>
    </div>
  );
}
