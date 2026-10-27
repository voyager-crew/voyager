import { describe, expect, it, vi } from 'vitest';

import { setupModelLockerTests } from './modelLockerHarness';

describe('DefaultStars thinking level', () => {
  const { startStars, buildThinkingSubmenu } = setupModelLockerTests();

  it('injects star buttons on Thinking level submenu items (Standard/Extended)', async () => {
    await startStars();

    // Main menu pane (containing the trigger row)
    const mainPane = document.createElement('div');
    mainPane.className = 'cdk-overlay-pane';
    const mainContainer = document.createElement('div');
    mainContainer.className = 'container';

    const thinkingRow = document.createElement('gem-menu-item');
    thinkingRow.setAttribute('role', 'menuitem');
    thinkingRow.setAttribute('value', 'thinking_level');
    thinkingRow.setAttribute('aria-haspopup', 'true');
    thinkingRow.setAttribute('aria-controls', 'ng-menu-test-thinking');
    thinkingRow.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container"><span class="label">Thinking level</span></div>
      </gem-menu-item-content>
    `;
    mainContainer.appendChild(thinkingRow);
    mainPane.appendChild(mainContainer);
    document.body.appendChild(mainPane);

    // Submenu pane (Standard/Extended)
    const submenuPane = document.createElement('div');
    submenuPane.className = 'cdk-overlay-pane';
    const submenuList = document.createElement('div');
    submenuList.id = 'ng-menu-test-thinking';
    submenuList.setAttribute('role', 'menu');

    const standard = document.createElement('gem-menu-item');
    standard.setAttribute('role', 'menuitem');
    standard.classList.add('selected');
    standard.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container"><span class="label">Standard</span></div>
      </gem-menu-item-content>
    `;
    const extended = document.createElement('gem-menu-item');
    extended.setAttribute('role', 'menuitem');
    extended.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container"><span class="label">Extended</span></div>
      </gem-menu-item-content>
    `;
    submenuList.appendChild(standard);
    submenuList.appendChild(extended);
    submenuPane.appendChild(submenuList);
    document.body.appendChild(submenuPane);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    expect(standard.querySelector('.gv-default-star-btn')).not.toBeNull();
    expect(extended.querySelector('.gv-default-star-btn')).not.toBeNull();
  });

  it('marks only one thinking level default when the stored index and label disagree', async () => {
    (chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: unknown, callback: (items: Record<string, unknown>) => void) => {
        // Drifted pairing: label says Extended, but the stored index points at Standard.
        // The old OR-match lit BOTH stars; the label must win and mark exactly one.
        callback({ gvDefaultThinkingLevel: { index: 0, label: 'Extended' } });
      },
    );

    await startStars();

    const { standard, extended } = buildThinkingSubmenu('ng-menu-double-star');

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    const standardStar = standard.querySelector<HTMLElement>('.gv-default-star-btn');
    const extendedStar = extended.querySelector<HTMLElement>('.gv-default-star-btn');
    expect(standardStar).not.toBeNull();
    expect(extendedStar).not.toBeNull();
    expect(extendedStar?.classList.contains('is-default')).toBe(true);
    expect(standardStar?.classList.contains('is-default')).toBe(false);
  });

  it('falls back to the stored index when the stored thinking label matches no row', async () => {
    (chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: unknown, callback: (items: Record<string, unknown>) => void) => {
        // Label from a previous UI language no longer matches any row → index wins.
        callback({ gvDefaultThinkingLevel: { index: 1, label: 'Reasoning' } });
      },
    );

    await startStars();

    const { standard, extended } = buildThinkingSubmenu('ng-menu-index-fallback');

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    const standardStar = standard.querySelector<HTMLElement>('.gv-default-star-btn');
    const extendedStar = extended.querySelector<HTMLElement>('.gv-default-star-btn');
    expect(extendedStar?.classList.contains('is-default')).toBe(true);
    expect(standardStar?.classList.contains('is-default')).toBe(false);
  });

  it('treats inline Thinking level choices as thinking stars, not model stars', async () => {
    (chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: unknown, callback: (items: Record<string, unknown>) => void) => {
        callback({
          gvDefaultModel: { id: 'flash-model-id', name: '3.5 Flash' },
          gvDefaultThinkingLevel: { index: 0, label: 'Standard' },
        });
      },
    );

    await startStars();

    const pane = document.createElement('div');
    pane.className = 'cdk-overlay-pane';

    const modelItem = document.createElement('gem-menu-item');
    modelItem.setAttribute('role', 'menuitem');
    modelItem.setAttribute('data-mode-id', 'flash-model-id');
    modelItem.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container"><span class="label">3.5 Flash</span></div>
      </gem-menu-item-content>
    `;

    const thinkingRow = document.createElement('gem-menu-item');
    thinkingRow.setAttribute('role', 'menuitem');
    thinkingRow.setAttribute('value', 'thinking_level');
    thinkingRow.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container">
          <span class="label">Thinking level</span>
          <span class="sublabel">Standard</span>
        </div>
      </gem-menu-item-content>
    `;

    const standard = document.createElement('gem-menu-item');
    standard.setAttribute('role', 'menuitem');
    standard.setAttribute('data-mode-id', 'flash-model-id');
    standard.classList.add('selected');
    standard.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container"><span class="label">Standard</span></div>
      </gem-menu-item-content>
    `;

    const extended = document.createElement('gem-menu-item');
    extended.setAttribute('role', 'menuitem');
    extended.setAttribute('data-mode-id', 'flash-model-id');
    extended.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container"><span class="label">Extended</span></div>
      </gem-menu-item-content>
    `;

    thinkingRow.append(standard, extended);
    pane.append(modelItem, thinkingRow);
    document.body.appendChild(pane);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    const modelStar = modelItem.querySelector<HTMLElement>('.gv-default-star-btn');
    const standardStar = standard.querySelector<HTMLElement>('.gv-default-star-btn');
    const extendedStar = extended.querySelector<HTMLElement>('.gv-default-star-btn');

    expect(modelStar?.title).toBe('cancelDefaultModel');
    expect(standardStar?.title).toBe('cancelDefaultThinkingLevel');
    expect(extendedStar?.title).toBe('setAsDefaultThinkingLevel');
    expect(standardStar?.classList.contains('is-default')).toBe(true);
    expect(extendedStar?.classList.contains('is-default')).toBe(false);
  });

  it('treats the inline Extended thinking toggle as a thinking preference (#808)', async () => {
    (chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: unknown, callback: (items: Record<string, unknown>) => void) => {
        callback({
          gvDefaultModel: { id: 'e6fa609c3fa255c0', name: '3.1 Pro' },
        });
      },
    );
    const setSpy = chrome.storage.sync.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await startStars();

    const pane = document.createElement('div');
    pane.className = 'cdk-overlay-pane';

    const pro = document.createElement('gem-menu-item');
    pro.setAttribute('role', 'menuitem');
    pro.setAttribute('data-mode-id', 'e6fa609c3fa255c0');
    pro.innerHTML = `<gem-menu-item-content><div class="label-container"><span class="label">3.1 Pro</span></div></gem-menu-item-content>`;

    const extended = document.createElement('gem-menu-item');
    extended.setAttribute('role', 'menuitem');
    extended.setAttribute(
      'jslog',
      '323336;track:generic_click,impression;BardVeMetadataKey:[["e6fa609c3fa255c0",2,3]]',
    );
    extended.innerHTML = `<gem-menu-item-content class="checkmark-only"><div class="label-container"><span class="label">Extended thinking</span><span class="sublabel">Complex problem solving</span></div></gem-menu-item-content>`;

    pane.append(pro, extended);
    document.body.appendChild(pane);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    const proStar = pro.querySelector<HTMLButtonElement>('.gv-default-star-btn');
    const extendedStar = extended.querySelector<HTMLButtonElement>('.gv-default-star-btn');

    expect(proStar?.title).toBe('cancelDefaultModel');
    expect(extendedStar?.title).toBe('setAsDefaultThinkingLevel');
    expect(extendedStar?.dataset.gvDefaultKind).toBe('thinking');
    expect(extendedStar?.classList.contains('is-default')).toBe(false);

    extendedStar?.click();
    await Promise.resolve();

    const writes = setSpy.mock.calls.map(([payload]) => payload as Record<string, unknown>);
    expect(writes).toContainEqual({
      gvDefaultThinkingLevel: {
        index: 0,
        label: 'Extended thinking',
        mode: 'extended',
      },
    });
    expect(writes.some((payload) => 'gvDefaultModel' in payload)).toBe(false);
  });

  it('does not inject star on the "Thinking level" submenu opener (aria-haspopup=true, no data-mode-id)', async () => {
    await startStars();

    const pane = document.createElement('div');
    pane.className = 'cdk-overlay-pane';
    const container = document.createElement('div');
    container.className = 'container';

    const modelItem = document.createElement('gem-menu-item');
    modelItem.setAttribute('role', 'menuitem');
    modelItem.setAttribute('data-mode-id', 'e6fa609c3fa255c0');
    modelItem.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container"><span class="label">3.1 Pro</span></div>
      </gem-menu-item-content>
    `;

    // Submenu trigger row — has a label, has role=menuitem, but no data-mode-id and aria-haspopup="true".
    const thinkingLevel = document.createElement('gem-menu-item');
    thinkingLevel.setAttribute('role', 'menuitem');
    thinkingLevel.setAttribute('aria-haspopup', 'true');
    thinkingLevel.setAttribute('aria-expanded', 'false');
    thinkingLevel.innerHTML = `
      <gem-menu-item-content>
        <div class="label-container"><span class="label">Thinking level</span><div class="sublabel">Standard</div></div>
        <div class="trailing-container"><gem-icon>arrow_right</gem-icon></div>
      </gem-menu-item-content>
    `;

    container.appendChild(modelItem);
    container.appendChild(thinkingLevel);
    pane.appendChild(container);
    document.body.appendChild(pane);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    expect(modelItem.querySelector('.gv-default-star-btn')).not.toBeNull();
    expect(thinkingLevel.querySelector('.gv-default-star-btn')).toBeNull();
  });
});
