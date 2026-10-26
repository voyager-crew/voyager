import type { TranslationKey } from '@/utils/translations';

import type { GeneralPopupSettings } from '../hooks/useGeneralPopupSettings';
import { GeneralSettingsCard } from './GeneralSettingsCard';
import { NativeCatalogUpdatesCard } from './NativeCatalogUpdatesCard';

interface PopupGeneralSettingsProps {
  settings: GeneralPopupSettings;
  catalogHost?: string;
  refreshing: boolean;
  onRefresh: () => void;
  canUseSystemNotifications: boolean;
  isVisible: (settingId: string) => boolean;
  t: (key: TranslationKey) => string;
}

/** Native sites share the catalog controls in their existing General section. */
export function PopupGeneralSettings({
  settings,
  catalogHost,
  refreshing,
  onRefresh,
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
      <NativeCatalogUpdatesCard
        catalogHost={catalogHost}
        refreshing={refreshing}
        onRefresh={onRefresh}
        visible={isVisible('onlineUpdates')}
      />
    </div>
  );
}
