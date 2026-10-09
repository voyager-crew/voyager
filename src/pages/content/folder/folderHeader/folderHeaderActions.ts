/**
 * The folder header's standard buttons, in one order on every site:
 * import/export, cloud, settings, Activity, create. A site supplies what each
 * does and may add its own buttons first (Gemini's current-user filter).
 */
import { createBellIcon } from '@/core/icons/bellIcon';
import { createFolderIcon, createPlusIcon, createSettingsIcon } from '@/core/icons/folderIcons';
import { DOWNLOAD_PATH, UPLOAD_PATH } from '@/core/icons/transferPaths';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import {
  type FolderHeaderAction,
  type FolderHeaderMenuItem,
  cloudMenuAction,
  menuIconHtml,
} from './folderHeader';

export type FolderHeaderActionsOptions = {
  /** The folders/Activity toggle; its label follows its state, so the site sets it. */
  activity?: { className?: string; pressed?: boolean; onClick: (event: MouseEvent) => void };
  /** Site buttons, placed before import/export. */
  extra?: readonly FolderHeaderAction[];
  transfer: { import: () => void; export: () => void };
  /** `tooltip`: the cloud button's title with the site's last upload and sync times. */
  cloud: { upload: () => void; sync: () => void; tooltip?: () => Promise<string> };
  settings: (event: MouseEvent) => void;
  create: {
    className?: string;
    labelKey: string;
    attributes?: Readonly<Record<string, string>>;
    onClick: () => void;
  };
  /** Every button but "create" shows only while the header is in use. */
  reveal?: boolean;
  iconSize?: number;
  /**
   * The page has Material Symbols (Gemini), so menu items name ligatures;
   * elsewhere they are inline SVG.
   */
  symbolFont?: boolean;
};

function transferItems(
  transfer: FolderHeaderActionsOptions['transfer'],
  symbolFont: boolean,
): FolderHeaderMenuItem[] {
  const icon = (ligature: string, path: string) =>
    symbolFont ? { icon: ligature } : { iconHtml: menuIconHtml(path) };
  return [
    { label: t('folder_import'), ...icon('upload', UPLOAD_PATH), action: transfer.import },
    { label: t('folder_export'), ...icon('download', DOWNLOAD_PATH), action: transfer.export },
  ];
}

export function folderHeaderActions(options: FolderHeaderActionsOptions): FolderHeaderAction[] {
  const { activity, reveal, symbolFont = false } = options;
  const size = options.iconSize ?? 18;
  return [
    ...(options.extra ?? []),
    {
      className: 'gv-folder-import-export-btn',
      icon: () => createFolderIcon(size),
      labelKey: 'folder_import_export',
      reveal,
      menu: () => transferItems(options.transfer, symbolFont),
    },
    cloudMenuAction(options.cloud, { reveal }),
    {
      className: 'gv-folder-settings-btn',
      icon: () => createSettingsIcon(size),
      labelKey: 'folder_settings',
      reveal,
      onClick: options.settings,
    },
    // A pressed bell stays visible while the reveal buttons fade but keep their
    // space, so it sits next to "create" with all of them on its left.
    ...(activity
      ? [
          {
            className: activity.className ?? 'gv-folder-activity-toggle',
            icon: () => createBellIcon(size),
            reveal,
            pressed: activity.pressed,
            onClick: activity.onClick,
          },
        ]
      : []),
    {
      className: options.create.className ?? 'gv-folder-add-btn',
      primary: true,
      icon: () => createPlusIcon(size),
      labelKey: options.create.labelKey,
      attributes: options.create.attributes,
      onClick: options.create.onClick,
    },
  ];
}
