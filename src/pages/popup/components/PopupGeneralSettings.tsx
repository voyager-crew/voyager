import type { TranslationKey } from '@/utils/translations';

import type { GeminiSelectorFixesControl } from '../hooks/useGeminiSelectorFixes';
import type { GeneralPopupSettings } from '../hooks/useGeneralPopupSettings';
import { GeminiSelectorFixesCard } from './GeminiSelectorFixesCard';
import { GeneralSettingsCard } from './GeneralSettingsCard';

interface PopupGeneralSettingsProps {
  settings: GeneralPopupSettings;
  selectorFixes: GeminiSelectorFixesControl;
  canUseSystemNotifications: boolean;
  isVisible: (settingId: string) => boolean;
  t: (key: TranslationKey) => string;
}

/** Keep the new control beside General without changing the user's saved section order. */
export function PopupGeneralSettings({
  settings,
  selectorFixes,
  canUseSystemNotifications,
  isVisible,
  t,
}: PopupGeneralSettingsProps) {
  return (
    <div className="space-y-4">
      <GeneralSettingsCard
        values={settings.values}
        onChange={settings.onChange}
        remoteAnnouncementPermissionCta={{
          visible:
            settings.values.remoteAnnouncementEnabled &&
            canUseSystemNotifications &&
            !settings.remoteAnnouncementPermissionGranted,
          onRequest: settings.requestRemoteAnnouncementSystemPermission,
        }}
        isVisible={isVisible}
        t={t}
      />
      <GeminiSelectorFixesCard control={selectorFixes} isVisible={isVisible} t={t} />
    </div>
  );
}
