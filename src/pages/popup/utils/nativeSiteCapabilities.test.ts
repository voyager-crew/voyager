import { describe, expect, it } from 'vitest';

import {
  POPUP_SECTION_SEARCH_SETTING_ID,
  isNativePopupSectionAvailable,
  isNativePopupSettingAvailable,
} from './nativeSiteCapabilities';

describe('native popup site capabilities', () => {
  it('keeps the complete settings surface on Gemini', () => {
    expect(isNativePopupSectionAvailable('gemini', 'keyboardShortcuts')).toBe(true);
    expect(isNativePopupSettingAvailable('gemini', 'folder', 'enableForkFeature')).toBe(true);
  });

  it('hides unsupported Gemini-only sections on AI Studio', () => {
    for (const sectionId of ['keyboardShortcuts', 'folderTreeIndent'] as const) {
      expect(isNativePopupSectionAvailable('aistudio', sectionId)).toBe(false);
    }
  });

  it('keeps supported AI Studio sections and all of their settings', () => {
    for (const sectionId of ['cloudSync', 'folderSpacing'] as const) {
      expect(isNativePopupSectionAvailable('aistudio', sectionId)).toBe(true);
      expect(isNativePopupSettingAvailable('aistudio', sectionId, 'any-setting')).toBe(true);
    }
  });

  it('filters mixed sections down to their supported AI Studio settings', () => {
    expect(isNativePopupSettingAvailable('aistudio', 'folder', 'enableFolderFeature')).toBe(true);
    expect(isNativePopupSettingAvailable('aistudio', 'folder', 'hideArchivedConversations')).toBe(
      true,
    );
    expect(isNativePopupSettingAvailable('aistudio', 'folder', 'enableAccountIsolation')).toBe(
      true,
    );
    expect(isNativePopupSettingAvailable('aistudio', 'folder', 'enableForkFeature')).toBe(false);
    expect(isNativePopupSettingAvailable('aistudio', 'general', 'changelogNotifyMode')).toBe(true);
    expect(isNativePopupSettingAvailable('aistudio', 'general', 'persistentExportToolbar')).toBe(
      false,
    );
    expect(isNativePopupSettingAvailable('aistudio', 'promptManager', 'hidePromptManager')).toBe(
      true,
    );
    expect(
      isNativePopupSettingAvailable('aistudio', 'promptManager', 'promptTriggerMascotLogo'),
    ).toBe(true);
    expect(isNativePopupSettingAvailable('aistudio', 'promptManager', 'slashPromptEnabled')).toBe(
      true,
    );
    expect(isNativePopupSettingAvailable('aistudio', 'promptManager', 'promptHistoryEnabled')).toBe(
      false,
    );
    expect(
      isNativePopupSettingAvailable('aistudio', 'general', 'remoteAnnouncementNotification'),
    ).toBe(true);
    expect(isNativePopupSettingAvailable('aistudio', 'general', 'enableMermaidRendering')).toBe(
      false,
    );
  });

  it('keeps searchable section headings only for available AI Studio sections', () => {
    expect(
      isNativePopupSettingAvailable('aistudio', 'folder', POPUP_SECTION_SEARCH_SETTING_ID),
    ).toBe(true);
    expect(
      isNativePopupSettingAvailable(
        'aistudio',
        'keyboardShortcuts',
        POPUP_SECTION_SEARCH_SETTING_ID,
      ),
    ).toBe(false);
  });
});
