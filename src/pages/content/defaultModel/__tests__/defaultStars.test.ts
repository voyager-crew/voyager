import { describe, expect, it, vi } from 'vitest';

import { toastDriver } from '@/tests/toastDriver';

import { setupModelLockerTests } from './modelLockerHarness';

describe('DefaultStars', () => {
  const { startStars } = setupModelLockerTests();

  it('skips sidebar subtree scans when Gemini renders conversation rows', async () => {
    await startStars();

    const sidebar = document.createElement('div');
    sidebar.setAttribute('data-test-id', 'overflow-container');
    const querySelectorSpy = vi.spyOn(sidebar, 'querySelector');
    const querySelectorAllSpy = vi.spyOn(sidebar, 'querySelectorAll');

    for (let i = 0; i < 20; i++) {
      const row = document.createElement('gem-nav-list-item');
      row.setAttribute('data-test-id', 'conversation');
      row.textContent = `Conversation ${i}`;
      sidebar.appendChild(row);
    }
    document.body.appendChild(sidebar);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);

    expect(querySelectorSpy).not.toHaveBeenCalled();
    expect(querySelectorAllSpy).not.toHaveBeenCalled();
  });

  it('injects star buttons even when menu items render after the panel is added', async () => {
    await startStars();

    const menuPanel = document.createElement('div');
    menuPanel.className = 'mat-mdc-menu-panel';
    menuPanel.setAttribute('role', 'menu');
    document.body.appendChild(menuPanel);

    await Promise.resolve(); // observer sees panel
    await vi.advanceTimersByTimeAsync(60); // initial delayed injection attempt

    // Render menu item after panel exists (common in Gemini).
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitemradio');
    item.innerHTML = `
      <div class="title-and-description">
        <div class="mode-title">Model A</div>
      </div>
    `;
    menuPanel.appendChild(item);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500); // Use a finite time advance to avoid infinite setInterval loop

    expect(item.querySelector('.gv-default-star-btn')).not.toBeNull();
  });

  it('injects star buttons into compact bottom-sheet mode switch list', async () => {
    await startStars();

    const mobileList = document.createElement('mat-action-list');
    mobileList.className = 'gds-mode-switch-menu-list';
    mobileList.setAttribute('role', 'group');

    const item = document.createElement('button');
    item.setAttribute('role', 'menuitemradio');
    item.innerHTML = `
      <div class="title-and-description">
        <div>
          <span class="gds-title-m">Pro</span>
          <span class="gds-body-m">Advanced math and code</span>
        </div>
      </div>
    `;
    mobileList.appendChild(item);
    document.body.appendChild(mobileList);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);

    expect(item.querySelector('.gv-default-star-btn')).not.toBeNull();
  });

  it('confirms setting and then clearing a default in a single toast', async () => {
    await startStars();
    const list = document.createElement('mat-action-list');
    list.className = 'gds-mode-switch-menu-list';
    list.setAttribute('role', 'group');
    const item = document.createElement('button');
    item.setAttribute('role', 'menuitemradio');
    item.innerHTML = `<div class="title-and-description"><div><span class="gds-title-m">Pro</span></div></div>`;
    list.appendChild(item);
    document.body.appendChild(list);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);
    const star = () => item.querySelector<HTMLButtonElement>('.gv-default-star-btn')!;

    star().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(toastDriver.messages()).toEqual(['defaultModelSet:Pro']);

    star().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(toastDriver.messages()).toEqual(['defaultModelCleared']);

    await vi.advanceTimersByTimeAsync(3000);
    expect(toastDriver.all()).toEqual([]);
  });

  it('injects star buttons when menu items use role="menuitem" instead of "menuitemradio"', async () => {
    await startStars();

    const menuPanel = document.createElement('div');
    menuPanel.className = 'mat-mdc-menu-panel gds-mode-switch-menu';
    menuPanel.setAttribute('role', 'menu');

    const item = document.createElement('button');
    item.setAttribute('role', 'menuitem');
    item.setAttribute('data-mode-id', 'e051ce1aa80aa576');
    item.classList.add('bard-mode-list-button');
    item.innerHTML = `
      <span class="mat-mdc-menu-item-text">
        <div class="title-and-check">
          <div class="title-and-description">
            <div>
              <span class="gds-label-l">思考</span>
              <span class="mode-desc gds-body-s">解决复杂问题</span>
            </div>
          </div>
        </div>
      </span>
    `;
    menuPanel.appendChild(item);
    document.body.appendChild(menuPanel);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);

    expect(item.querySelector('.gv-default-star-btn')).not.toBeNull();
  });

  it('does not inject star buttons into the settings menu (desktop-settings-menu)', async () => {
    await startStars();

    // Simulate the Gemini settings/profile dropdown (has class desktop-settings-menu)
    const settingsMenu = document.createElement('div');
    settingsMenu.className = 'mat-mdc-menu-panel collapsed desktop-settings-menu ia-redesign';
    settingsMenu.setAttribute('role', 'menu');

    const settingsItem = document.createElement('a');
    settingsItem.setAttribute('role', 'menuitem');
    settingsItem.innerHTML = `
      <span class="mat-mdc-menu-item-text">
        <div class="menu-entry-with-badge">
          <span class="gds-label-l">个人使用场景</span>
        </div>
      </span>
    `;
    settingsMenu.appendChild(settingsItem);

    const themeItem = document.createElement('button');
    themeItem.setAttribute('role', 'menuitem');
    themeItem.innerHTML = `
      <span class="mat-mdc-menu-item-text">
        <span class="gds-label-l">主题</span>
      </span>
    `;
    settingsMenu.appendChild(themeItem);

    document.body.appendChild(settingsMenu);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    // Star buttons should NOT be injected into settings menu items
    expect(settingsItem.querySelector('.gv-default-star-btn')).toBeNull();
    expect(themeItem.querySelector('.gv-default-star-btn')).toBeNull();
  });

  it('does not inject star buttons into the theme submenu (menuitemradio without model markers)', async () => {
    await startStars();

    // Simulate the Gemini theme picker submenu (has menuitemradio but no model markers)
    const themeMenu = document.createElement('div');
    themeMenu.className = 'mat-mdc-menu-panel';
    themeMenu.setAttribute('role', 'menu');

    const systemItem = document.createElement('button');
    systemItem.setAttribute('role', 'menuitemradio');
    systemItem.setAttribute('aria-checked', 'false');
    systemItem.innerHTML = `
      <span class="mat-mdc-menu-item-text">
        <span class="menu-item-title-with-trailing-component">
          <span class="gds-label-l">系统</span>
        </span>
      </span>
    `;
    themeMenu.appendChild(systemItem);

    const darkItem = document.createElement('button');
    darkItem.setAttribute('role', 'menuitemradio');
    darkItem.setAttribute('aria-checked', 'true');
    darkItem.innerHTML = `
      <span class="mat-mdc-menu-item-text">
        <span class="menu-item-title-with-trailing-component">
          <span class="gds-label-l">深色</span>
        </span>
      </span>
    `;
    themeMenu.appendChild(darkItem);

    document.body.appendChild(themeMenu);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    // Star buttons should NOT be injected into theme menu items
    expect(systemItem.querySelector('.gv-default-star-btn')).toBeNull();
    expect(darkItem.querySelector('.gv-default-star-btn')).toBeNull();
  });

  it('does not inject star buttons into Gemini table options menu DOM', async () => {
    await startStars();

    document.body.insertAdjacentHTML(
      'beforeend',
      `
        <div class="cdk-overlay-container">
          <div class="cdk-global-overlay-wrapper" dir="ltr">
            <div class="cdk-overlay-pane">
              <gem-menu role="menu" class="mat-mdc-menu-panel">
                <gem-menu-item role="menuitem" jslog="121782;track:deadbeefcafebabe">
                  <gem-menu-item-content>
                    <div class="leading-container">
                      <gem-icon>
                        <mat-icon class="mat-icon notranslate lm-icon-m lumi-symbols mat-ligature-font" fonticon="content_copy" role="img"></mat-icon>
                      </gem-icon>
                    </div>
                    <div class="label-container"><span class="label"><span>复制表格</span></span></div>
                    <div class="trailing-container"></div>
                  </gem-menu-item-content>
                </gem-menu-item>
                <gem-menu-item role="menuitem" jslog="121783;track:0123456789abcdef">
                  <gem-menu-item-content>
                    <div class="leading-container">
                      <gem-icon>
                        <mat-icon class="mat-icon notranslate lm-icon-m lumi-symbols mat-ligature-font" fonticon="open_in_new" role="img"></mat-icon>
                      </gem-icon>
                    </div>
                    <div class="label-container"><span class="label"><span>在表格中打开</span></span></div>
                    <div class="trailing-container"></div>
                  </gem-menu-item-content>
                </gem-menu-item>
              </gem-menu>
            </div>
          </div>
        </div>
      `,
    );

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    const pane = document.querySelector<HTMLElement>('.cdk-overlay-pane');
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('gem-menu-item[role="menuitem"]'),
    );
    expect(pane).not.toBeNull();
    expect(items).toHaveLength(2);
    expect(pane?.querySelector('.gv-default-star-btn')).toBeNull();
    expect(items.map((item) => item.textContent?.trim())).toEqual(['复制表格', '在表格中打开']);
  });

  it('injects star buttons into the 2026 redesigned overlay (gem-menu-item + .label-container)', async () => {
    await startStars();

    const pane = document.createElement('div');
    pane.className = 'cdk-overlay-pane';

    const container = document.createElement('div');
    container.className = 'container';

    const item = document.createElement('gem-menu-item');
    item.setAttribute('role', 'menuitem');
    item.setAttribute('data-mode-id', 'e6fa609c3fa255c0');
    item.innerHTML = `
      <gem-menu-item-content class="checkmark-only">
        <div class="leading-container"></div>
        <div class="label-container">
          <span class="label">3.1 Pro</span>
          <div class="sublabel">Advanced math &amp; code</div>
        </div>
        <div class="trailing-container"></div>
      </gem-menu-item-content>
    `;

    container.appendChild(item);
    pane.appendChild(container);
    document.body.appendChild(pane);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    expect(item.querySelector('.gv-default-star-btn')).not.toBeNull();
  });

  it('reveals only the star owned by the hovered menu item', async () => {
    await startStars();

    const pane = document.createElement('div');
    pane.className = 'cdk-overlay-pane';

    const parent = document.createElement('gem-menu-item');
    parent.setAttribute('role', 'menuitem');
    parent.setAttribute('data-mode-id', 'parent-model-id');
    parent.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container"><span class="label">Parent Model</span></div>
      </gem-menu-item-content>
    `;

    const child = document.createElement('gem-menu-item');
    child.setAttribute('role', 'menuitem');
    child.setAttribute('data-mode-id', 'child-model-id');
    child.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container"><span class="label">Child Model</span></div>
      </gem-menu-item-content>
    `;

    parent.appendChild(child);
    pane.appendChild(parent);
    document.body.appendChild(pane);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    const starForLabel = (labelText: string) => {
      const label = Array.from(pane.querySelectorAll<HTMLElement>('.label')).find(
        (el) => el.textContent === labelText,
      );
      return label
        ?.closest('.gv-title-wrapper')
        ?.querySelector<HTMLElement>('.gv-default-star-btn');
    };

    const parentStar = starForLabel('Parent Model');
    const childStar = starForLabel('Child Model');
    expect(parentStar).toBeTruthy();
    expect(childStar).toBeTruthy();

    parent.dispatchEvent(new MouseEvent('mouseenter'));

    expect(parentStar?.classList.contains('is-owner-hovered')).toBe(true);
    expect(childStar?.classList.contains('is-owner-hovered')).toBe(false);
  });

  it('injects star buttons when the CDK position wrapper is the added node', async () => {
    await startStars();

    const wrapper = document.createElement('div');
    wrapper.className = 'cdk-overlay-connected-position-bounding-box';

    const pane = document.createElement('div');
    pane.className = 'cdk-overlay-pane';

    const item = document.createElement('gem-menu-item');
    item.setAttribute('role', 'menuitem');
    item.setAttribute('data-mode-id', 'e6fa609c3fa255c0');
    item.innerHTML = `
      <gem-menu-item-content class="checkmark-only">
        <div class="label-container">
          <span class="label">3.1 Pro</span>
        </div>
      </gem-menu-item-content>
    `;

    pane.appendChild(item);
    wrapper.appendChild(pane);
    document.body.appendChild(wrapper);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    expect(item.querySelector('.gv-default-star-btn')).not.toBeNull();
  });

  it('injects star buttons when a populated child is added inside an existing CDK pane', async () => {
    const pane = document.createElement('div');
    pane.className = 'cdk-overlay-pane';
    document.body.appendChild(pane);

    await startStars();

    const container = document.createElement('div');
    container.className = 'container';

    const item = document.createElement('gem-menu-item');
    item.setAttribute('role', 'menuitem');
    item.setAttribute('data-mode-id', 'e6fa609c3fa255c0');
    item.innerHTML = `
      <gem-menu-item-content class="checkmark-only">
        <div class="label-container">
          <span class="label">3.1 Pro</span>
        </div>
      </gem-menu-item-content>
    `;

    container.appendChild(item);
    pane.appendChild(container);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    expect(item.querySelector('.gv-default-star-btn')).not.toBeNull();
  });
});
