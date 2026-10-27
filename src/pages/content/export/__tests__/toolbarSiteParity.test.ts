import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountPersistentExportToolbar } from '../persistentExportToolbar';
import { cleanUpToolbars, mockRect, nextFrame } from './persistentExportToolbarHarness';

afterEach(() => {
  cleanUpToolbars();
  document.body.replaceChildren();
});

describe('bundled export placement', () => {
  it.each(['gemini', 'aistudio', 'chatgpt', 'claude', 'deepseek', 'kimi', 'custom'])(
    '%s keeps the export toolbar clear of upgrade and Pro controls',
    async (siteId) => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
      const control = document.createElement('button');
      control.setAttribute('aria-label', 'Upgrade');
      mockRect(control, { top: 8, bottom: 44, left: 960, right: 1130, width: 170, height: 36 });
      document.body.appendChild(control);
      const handle = mountPersistentExportToolbar({
        label: 'Export',
        tooltip: 'Export',
        onClick: () => {},
      });
      handle.root.dataset.gvPlatform = siteId;
      await nextFrame();
      expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('332px');
      const pro = document.createElement('button');
      pro.setAttribute('aria-label', 'Pro');
      mockRect(pro, { top: 8, bottom: 44, left: 900, right: 1130, width: 230, height: 36 });
      control.replaceWith(pro);
      await nextFrame();
      await nextFrame();
      expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('392px');
      pro.remove();
      await nextFrame();
      await nextFrame();
      expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');
      handle.remove();
    },
  );
});
