import React from 'react';

import type { TranslationKey } from '@/utils/translations';

import { Card, CardContent, CardTitle } from '../../../components/ui/card';
import type { PromptDataTransferController } from '../hooks/usePromptDataTransfer';
import type { PromptManagerSettings } from '../hooks/usePromptManagerSettings';
import { POPUP_SECTION_SEARCH_SETTING_ID } from '../utils/nativeSiteCapabilities';
import { PromptDataTransfer } from './PromptDataTransfer';
import { SettingToggleRow } from './SettingToggleRow';

/** Prompt Manager's own settings; where it runs is the site access card's. */
export interface PromptManagerSettingsCardProps {
  settings: Pick<PromptManagerSettings, 'values' | 'onChange'>;
  transfer: PromptDataTransferController;
  t: (key: TranslationKey) => string;
  isVisible: (settingId: string) => boolean;
}

export function PromptManagerSettingsCard({
  settings,
  transfer,
  t,
  isVisible,
}: PromptManagerSettingsCardProps) {
  const { values, onChange } = settings;

  return (
    <Card className="p-4">
      <CardTitle className="mb-4">{t('promptManagerOptions')}</CardTitle>
      <CardContent className="space-y-3 p-0">
        <SettingToggleRow
          id="hide-prompt-manager"
          settingId="hidePromptManager"
          label="hidePromptManager"
          hint="hidePromptManagerHint"
          checked={values.hidePromptManager}
          onChange={(hidePromptManager) => onChange({ hidePromptManager })}
          isVisible={isVisible}
          unmountWhenHidden
          t={t}
        />
        <SettingToggleRow
          id="prompt-trigger-mascot-logo"
          settingId="promptTriggerMascotLogo"
          label="promptTriggerMascotLogo"
          hint="promptTriggerMascotLogoHint"
          checked={values.promptTriggerMascotLogo}
          onChange={(promptTriggerMascotLogo) => onChange({ promptTriggerMascotLogo })}
          isVisible={isVisible}
          unmountWhenHidden
          t={t}
        />
        <SettingToggleRow
          id="slash-prompt-enabled"
          settingId="slashPromptEnabled"
          label="slashPromptEnabled"
          hint="slashPromptEnabledHint"
          checked={values.slashPromptEnabled}
          onChange={(slashPromptEnabled) => onChange({ slashPromptEnabled })}
          isVisible={isVisible}
          unmountWhenHidden
          t={t}
        />
        <SettingToggleRow
          id="prompt-insert-on-click"
          settingId="promptInsertOnClick"
          label="promptInsertOnClick"
          hint="promptInsertOnClickHint"
          checked={values.promptInsertOnClickEnabled}
          onChange={(promptInsertOnClickEnabled) => onChange({ promptInsertOnClickEnabled })}
          isVisible={isVisible}
          unmountWhenHidden
          t={t}
        />
        {isVisible('promptDataMigration') && <PromptDataTransfer t={t} transfer={transfer} />}
        {isVisible(POPUP_SECTION_SEARCH_SETTING_ID) && (
          <p className="text-muted-foreground text-xs leading-snug">
            {t('promptManagerSitesNote')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
