import React from 'react';

import type { ChangelogNotifyMode } from '@/core/utils/changelogNotifyMode';
import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { SettingToggleRow } from './SettingToggleRow';

/** Every general setting the card edits; the popup owns the state and persistence. */
export interface GeneralSettingsValues {
  persistentExportToolbarEnabled: boolean;
  remoteAnnouncementEnabled: boolean;
  changelogNotifyMode: ChangelogNotifyMode;
}

type GeneralToggleKey = {
  [K in keyof GeneralSettingsValues]: GeneralSettingsValues[K] extends boolean ? K : never;
}[keyof GeneralSettingsValues];

const CHANGELOG_NOTIFY_OPTIONS = [
  { value: 'popup', label: 'changelog_notify_mode_popup' },
  { value: 'badge', label: 'changelog_notify_mode_badge' },
  { value: 'off', label: 'changelog_notify_mode_off' },
] as const satisfies readonly { value: ChangelogNotifyMode; label: TranslationKey }[];

export interface GeneralSettingsCardProps {
  values: GeneralSettingsValues;
  /** One key per call; the popup decides how each key is persisted. */
  onChange: (patch: Partial<GeneralSettingsValues>) => void;
  /** Shown under the announcements row until system notifications are granted. */
  remoteAnnouncementPermissionCta: { visible: boolean; onRequest: () => void };
  /** Site capability and settings-search gate, keyed by the setting's search id. */
  isVisible: (settingId: string) => boolean;
  t: (key: TranslationKey) => string;
}

export function GeneralSettingsCard({
  values,
  onChange,
  remoteAnnouncementPermissionCta,
  isVisible,
  t,
}: GeneralSettingsCardProps) {
  const row = (
    id: string,
    settingId: string,
    key: GeneralToggleKey,
    label: TranslationKey,
    hint: TranslationKey,
    options: { disabled?: boolean; extra?: React.ReactNode; experimental?: boolean } = {},
  ) => (
    <SettingToggleRow
      id={id}
      settingId={settingId}
      label={label}
      hint={hint}
      checked={values[key]}
      disabled={options.disabled}
      experimental={options.experimental}
      extra={options.extra}
      onChange={(checked) => onChange({ [key]: checked })}
      isVisible={isVisible}
      unmountWhenHidden
      t={t}
    />
  );

  return (
    <Card className="p-4">
      <CardTitle className="mb-4">{t('generalOptions')}</CardTitle>
      <CardContent className="space-y-4 p-0">
        <SettingToggleRow
          id="tab-title-update"
          settingId="enableTabTitleUpdate"
          label="enableTabTitleUpdate"
          hint="enableTabTitleUpdateHint"
          checked={false}
          disabled
          onChange={() => {}}
          isVisible={isVisible}
          unmountWhenHidden
          t={t}
        />
        {row(
          'persistent-export-toolbar',
          'persistentExportToolbar',
          'persistentExportToolbarEnabled',
          'persistentExportToolbar',
          'persistentExportToolbarHint',
        )}
        {row(
          'remote-announcement-notification',
          'remoteAnnouncementNotification',
          'remoteAnnouncementEnabled',
          'remoteAnnouncementNotification',
          'remoteAnnouncementNotificationHint',
          {
            extra: remoteAnnouncementPermissionCta.visible ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 h-7 px-2.5 text-xs"
                onClick={remoteAnnouncementPermissionCta.onRequest}
              >
                {t('remoteAnnouncementSystemPermissionCta')}
              </Button>
            ) : null,
          },
        )}
        {isVisible('changelogNotifyMode') && (
          <div>
            <p id="changelog-notify-mode-label" className="text-sm leading-5 font-medium">
              {t('changelog_notify_mode')}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">{t('changelog_notify_mode_hint')}</p>
            <SegmentedControl
              aria-labelledby="changelog-notify-mode-label"
              className="mt-2"
              options={CHANGELOG_NOTIFY_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.label),
              }))}
              value={values.changelogNotifyMode}
              onChange={(changelogNotifyMode) => onChange({ changelogNotifyMode })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
