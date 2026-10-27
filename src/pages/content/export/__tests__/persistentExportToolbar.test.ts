import { afterEach, describe, expect, it, vi } from 'vitest';

import { readContentStyle } from '@/tests/contentStyle';

import {
  mountPersistentExportToolbar,
  openPersistentExportToolbar,
} from '../persistentExportToolbar';
import {
  cleanUpToolbars,
  mockRect,
  nextFrame,
  stubElementsFromPoint,
} from './persistentExportToolbarHarness';

afterEach(cleanUpToolbars);

describe('persistentExportToolbar', () => {
  it('mounts a top-right export button with label and tooltip', () => {
    const onClick = vi.fn();
    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick,
    });
    expect(document.querySelector('.gv-persistent-export-toolbar')).not.toBeNull();
    expect(handle.root.classList.contains('gv-persistent-export-toolbar')).toBe(true);
    expect(handle.button.getAttribute('aria-label')).toBe('Export chat history');
    expect(handle.button.title).toBe('Export chat history');
    expect(handle.button.textContent).toContain('Export');
  });

  it('invokes onClick when the button is clicked', () => {
    const onClick = vi.fn();
    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick,
    });
    handle.button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('opens the export flow through the mounted toolbar from outside the page UI', () => {
    expect(openPersistentExportToolbar()).toBe(false);

    const firstOwner = vi.fn();
    mountPersistentExportToolbar({ label: 'Export', tooltip: 'Export', onClick: firstOwner });
    const currentOwner = vi.fn();
    mountPersistentExportToolbar({ label: 'Export', tooltip: 'Export', onClick: currentOwner });

    expect(openPersistentExportToolbar()).toBe(true);
    expect(currentOwner).toHaveBeenCalledOnce();
    expect(firstOwner).not.toHaveBeenCalled();
  });

  it('cannot open the export flow after the toolbar is removed', () => {
    const onClick = vi.fn();
    const handle = mountPersistentExportToolbar({ label: 'Export', tooltip: 'Export', onClick });
    handle.remove();

    expect(openPersistentExportToolbar()).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("remounts with the latest handler and ignores the previous owner's cleanup", () => {
    const firstClick = vi.fn();
    const secondClick = vi.fn();
    const first = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: firstClick,
    });
    const second = mountPersistentExportToolbar({
      label: '导出',
      tooltip: '导出对话历史',
      onClick: secondClick,
    });
    expect(document.querySelectorAll('.gv-persistent-export-toolbar').length).toBe(1);
    expect(second.root).toBe(first.root);
    expect(first.button.getAttribute('aria-label')).toBe('导出对话历史');
    expect(first.button.textContent).toContain('导出');
    second.button.click();
    expect(firstClick).not.toHaveBeenCalled();
    expect(secondClick).toHaveBeenCalledOnce();

    first.remove();
    expect(document.querySelector('.gv-persistent-export-toolbar')).not.toBeNull();
    second.remove();
    expect(document.querySelector('.gv-persistent-export-toolbar')).toBeNull();
  });

  it('keeps ChatGPT toolbar avoidance and paints the button from the theme tokens', () => {
    const css = readContentStyle();
    const platformRule = css.match(
      /\.gv-persistent-export-toolbar\[data-gv-platform='chatgpt'\]\s*\{([^}]*)\}/,
    )?.[1];

    expect(platformRule).toContain('top: 8px');
    expect(platformRule).not.toContain('right:');
    // A ghost button like the host's own Share: its ink and hover wash follow
    // data-gv-scheme through the shared tokens instead of per-theme literals,
    // and the accent only reaches the focus ring.
    const button = css.match(/\.gv-persistent-export-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    const hover = css.match(/\.gv-persistent-export-btn:hover[^{]*\{([^}]*)\}/)?.[1] ?? '';
    expect(button).toContain('var(--gv-ui-text)');
    expect(button).toMatch(/background:\s*transparent/);
    expect(button).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/i);
    expect(hover).toContain('var(--gv-ui-hover)');
    expect(hover).not.toContain('--gv-pm-brand');
  });

  it('setText updates label/tooltip after language change', () => {
    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });
    handle.setText('Exporter', 'Exporter la conversation');
    expect(handle.button.title).toBe('Exporter la conversation');
    expect(handle.button.getAttribute('aria-label')).toBe('Exporter la conversation');
    expect(handle.button.textContent).toContain('Exporter');
  });

  it('keeps the default right offset when no top-right controls are present', async () => {
    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });

    await nextFrame();

    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');
  });

  it('moves left to avoid Gemini top-right upgrade controls', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    const upgradeButton = document.createElement('button');
    upgradeButton.setAttribute('data-test-id', 'upgrade-button');
    mockRect(upgradeButton, {
      top: 8,
      bottom: 44,
      left: 960,
      right: 1130,
      width: 170,
      height: 36,
    });
    document.body.appendChild(upgradeButton);

    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });

    await nextFrame();

    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('332px');
  });

  it('updates avoidance when Gemini renders top-right controls after mount', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });
    await nextFrame();
    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');

    const topBarActions = document.createElement('top-bar-actions');
    mockRect(topBarActions, {
      top: 0,
      bottom: 56,
      left: 920,
      right: 1260,
      width: 340,
      height: 56,
    });
    document.body.appendChild(topBarActions);
    await Promise.resolve();
    await nextFrame();

    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('372px');
  });

  it('moves left to avoid ChatGPT header share actions', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    const headerActions = document.createElement('div');
    headerActions.id = 'conversation-header-actions';
    mockRect(headerActions, {
      top: 8,
      bottom: 48,
      left: 1040,
      right: 1268,
      width: 228,
      height: 40,
    });
    document.body.appendChild(headerActions);

    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });
    handle.root.setAttribute('data-gv-platform', 'chatgpt');

    await nextFrame();

    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('252px');
  });

  it('moves left of unlabeled header controls rendered under the ChatGPT toolbar', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    const header = document.createElement('header');
    const share = document.createElement('button');
    const shareLabel = document.createElement('span');
    share.appendChild(shareLabel);
    header.appendChild(share);
    document.body.appendChild(header);
    mockRect(share, { top: 4, bottom: 48, left: 1129, right: 1181, width: 52, height: 44 });
    stubElementsFromPoint((x, y) =>
      y >= 4 && y <= 48 && x >= 1129 && x <= 1181 ? [shareLabel] : [header],
    );

    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });
    handle.root.setAttribute('data-gv-platform', 'chatgpt');
    mockRect(handle.root, { top: 12, bottom: 48, width: 82, height: 36 });

    await nextFrame();

    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('163px');
    header.remove();
  });

  it('moves left of an unlabeled ChatGPT header control rendered after mount', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    const header = document.createElement('header');
    document.body.appendChild(header);
    let share: HTMLButtonElement | null = null;
    stubElementsFromPoint((x, y) =>
      share && y >= 4 && y <= 48 && x >= 1129 && x <= 1181 ? [share] : [header],
    );

    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });
    handle.root.setAttribute('data-gv-platform', 'chatgpt');
    mockRect(handle.root, { top: 12, bottom: 48, width: 82, height: 36 });
    await nextFrame();
    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');

    share = document.createElement('button');
    mockRect(share, { top: 4, bottom: 48, left: 1129, right: 1181, width: 52, height: 44 });
    header.appendChild(share);
    await Promise.resolve();
    await nextFrame();

    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('163px');
    header.remove();
  });

  it('keeps clear of Share while the export dialog is open', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    const header = document.createElement('header');
    const share = document.createElement('button');
    header.appendChild(share);
    document.body.appendChild(header);
    mockRect(share, { top: 4, bottom: 48, left: 1129, right: 1181, width: 52, height: 44 });
    // The dialog's full-page overlay is topmost everywhere, the header row included.
    const overlay = document.createElement('div');
    overlay.className = 'gv-export-dialog-overlay';
    overlay.appendChild(document.createElement('button'));
    document.body.appendChild(overlay);
    stubElementsFromPoint((x, y) =>
      y >= 4 && y <= 48 && x >= 1129 && x <= 1181 ? [overlay, share] : [overlay, header],
    );

    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });
    handle.root.setAttribute('data-gv-platform', 'chatgpt');
    mockRect(handle.root, { top: 12, bottom: 48, width: 82, height: 36 });

    await nextFrame();

    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('163px');
    overlay.remove();
    header.remove();
  });

  it('moves left of an unlabeled header control on Gemini too', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    const control = document.createElement('button');
    document.body.appendChild(control);
    mockRect(control, { top: 4, bottom: 48, left: 1129, right: 1181, width: 52, height: 44 });
    stubElementsFromPoint(() => [control]);

    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });
    mockRect(handle.root, { top: 12, bottom: 48, width: 82, height: 36 });

    await nextFrame();

    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('163px');
    control.remove();
  });

  it('ignores full-width top-bar containers so the toolbar stays top-right', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    const topBarActions = document.createElement('top-bar-actions');
    mockRect(topBarActions, {
      top: 0,
      bottom: 56,
      left: 0,
      right: 1280,
      width: 1280,
      height: 56,
    });
    document.body.appendChild(topBarActions);

    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });

    await nextFrame();

    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');
  });

  it('does not move over a user message whose copy button is scrolled into the top band', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1882);
    const userQuery = document.createElement('user-query');
    const copyPrompt = document.createElement('button');
    copyPrompt.setAttribute('aria-label', 'Copy prompt');
    mockRect(copyPrompt, { top: 40, bottom: 76, left: 1347, right: 1383, width: 36, height: 36 });
    userQuery.appendChild(copyPrompt);
    document.body.appendChild(userQuery);

    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
    });

    await nextFrame();

    expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');
  });
});
