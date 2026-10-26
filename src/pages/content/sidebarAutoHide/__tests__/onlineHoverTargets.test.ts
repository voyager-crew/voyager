import { afterEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { createHoverIntent } from '../hoverIntent';
import { getSidebarHoverPopups } from '../popupTargets';

let stop = () => {};
afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('online sidebar hover protection', () => {
  it('reads the same complete popup view through bundled and remote profiles', async () => {
    document.body.innerHTML =
      '<div id="dialog" class="mat-mdc-dialog-container" role="dialog"></div><div id="menu" class="mat-mdc-menu-panel" role="menu"></div>';
    const bundled = getSidebarHoverPopups();
    stop = await installGeminiSelectorPatch({
      'sidebarHover.dialogs': ['#dialog'],
      'sidebarHover.menus': ['#menu'],
    });
    expect(getSidebarHoverPopups()).toEqual(bundled);
    expect(bundled.dialogs.map((node) => node.id)).toEqual(['dialog']);
    expect(bundled.menus.map((node) => node.id)).toEqual(['menu']);
  });

  it('keeps the sidebar open while a renamed settings menu is visible', async () => {
    document.body.innerHTML = '<div id="menu" role="menu"></div>';
    vi.spyOn(document.getElementById('menu')!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 240, 120),
    );
    const hover = createHoverIntent({
      isEnabled: () => true,
      isEdgeHovered: () => false,
      expand: () => {},
      collapse: () => {},
    });
    expect(hover.canCollapse()).toBe(true);
    stop = await installGeminiSelectorPatch({ 'sidebarHover.menus': ['#menu'] });
    expect(hover.canCollapse()).toBe(false);
    document.getElementById('menu')!.remove();
    expect(hover.canCollapse()).toBe(true);
    hover.stop();
  });

  it('falls back both collections when a patch omits a bundled menu', async () => {
    document.body.innerHTML =
      '<div id="dialog" role="dialog"></div><div id="one" class="mat-mdc-menu-panel" role="menu"></div><div id="two" class="mat-mdc-menu-panel" role="menu"></div>';
    stop = await installGeminiSelectorPatch({
      'sidebarHover.dialogs': ['#dialog'],
      'sidebarHover.menus': ['#one'],
    });
    const result = getSidebarHoverPopups();
    expect(result).toEqual({
      dialogs: [],
      menus: [document.getElementById('one'), document.getElementById('two')],
    });
  });

  it('does not replace an open dialog with unrelated content', async () => {
    document.body.innerHTML =
      '<div id="dialog" class="mat-mdc-dialog-container"></div><div id="wrong"></div>';
    stop = await installGeminiSelectorPatch({ 'sidebarHover.dialogs': ['#wrong'] });
    expect(getSidebarHoverPopups().dialogs).toEqual([document.getElementById('dialog')]);
  });

  it('rejects a partial native popup view and recovers when the complete list is present', async () => {
    document.body.innerHTML =
      '<div id="one" role="menu"></div><div id="two" role="menu"></div><div class="mat-mdc-dialog-container" id="dialog"></div>';
    stop = await installGeminiSelectorPatch({ 'sidebarHover.menus': ['#one'] });
    expect(getSidebarHoverPopups()).toEqual({
      dialogs: [document.getElementById('dialog')],
      menus: [],
    });
    document.getElementById('two')!.remove();
    expect(getSidebarHoverPopups().menus).toEqual([document.getElementById('one')]);
  });
});
