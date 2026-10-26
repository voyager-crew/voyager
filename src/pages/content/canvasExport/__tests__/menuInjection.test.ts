import { afterEach, describe, expect, it } from 'vitest';

import {
  CANVAS_MARKDOWN_BUTTON_CLASS,
  findCanvasProseMirrorRoot,
  injectCanvasCopyMarkdownButton,
  isCanvasExportMenuPanel,
  removeCanvasCopyMarkdownButton,
  resolveCanvasEntryPanels,
} from '../menuInjection';
import { canvasFixture, fillMenu, setup } from './fixtures';

const labels = { label: 'Copy as Markdown', tooltip: 'Copy Canvas content as Markdown' };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Canvas Export menu', () => {
  it('recognizes download_md independently of translated labels', () => {
    const panel = setup();
    panel.querySelector('.label')!.textContent = 'Télécharger';
    document.querySelector('button')!.setAttribute('aria-label', 'Exporter');
    expect(isCanvasExportMenuPanel(panel)).toBe(true);
    panel.querySelector('[value="download_md"]')!.setAttribute('value', 'other');
    expect(isCanvasExportMenuPanel(panel)).toBe(false);
  });

  it('excludes Deep Research and menus with no associated Canvas', () => {
    const panel = setup();
    document.body.append(document.createElement('deep-research-immersive-panel'));
    expect(injectCanvasCopyMarkdownButton(panel, labels)).toBeNull();
    document.querySelector('deep-research-immersive-panel')!.remove();
    document.querySelector('inline-preview')!.remove();
    expect(injectCanvasCopyMarkdownButton(panel, labels)).toBeNull();
  });

  it.each(['inline-preview', 'immersive-panel'])(
    'resolves the controlling trigger inside %s with two editors',
    (owner) => {
      const panel = setup(true, owner);
      const expected = document.querySelector('.ProseMirror');
      document.body.insertAdjacentHTML('afterbegin', canvasFixture('inline-preview', 'other-menu'));
      expect(findCanvasProseMirrorRoot(panel)).toBe(expected);
    },
  );

  it('uses a locally nested menu owner when the trigger has no ARIA association', () => {
    const panel = setup();
    document.querySelector('gem-button')!.removeAttribute('aria-controls');
    document.querySelector('inline-preview')!.append(panel);
    expect(findCanvasProseMirrorRoot(panel)).toBe(document.querySelector('.ProseMirror'));
  });

  it('does not guess the first editor for an unassociated portal menu', () => {
    const panel = setup();
    document.querySelector('gem-button')!.removeAttribute('aria-controls');
    expect(injectCanvasCopyMarkdownButton(panel, labels)).toBeNull();
  });

  it('clones native structure after .md without inheriting its action or active state', () => {
    const panel = setup();
    const download = panel.querySelector('[value="download_md"]')!;
    const button = injectCanvasCopyMarkdownButton(panel, labels)!;
    expect(button.tagName).toBe('GEM-MENU-ITEM');
    expect(download.nextElementSibling).toBe(button);
    expect(button.querySelector('gem-menu-item-content .label')?.textContent).toBe(labels.label);
    expect(button.querySelector('mat-icon')?.getAttribute('fonticon')).toBe('content_copy');
    expect(button.querySelector('mat-icon')?.classList.contains('google-symbols')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe(labels.tooltip);
    expect(button.getAttribute('arialabel')).toBe(labels.tooltip);
    expect(button.getAttribute('role')).toBe('menuitem');
    expect(button.tabIndex).toBe(-1);
    expect(button.matches('.active, [value], [jslog], [data-active]')).toBe(false);
    expect(button.querySelector('.active, [value], [jslog], [data-active]')).toBeNull();
    expect(download.matches('.active[value="download_md"][jslog]')).toBe(true);
    expect(download.querySelector('.active')).not.toBeNull();
  });

  it('refreshes labels on repeated injection without duplication', () => {
    const panel = setup();
    const first = injectCanvasCopyMarkdownButton(panel, labels);
    const second = injectCanvasCopyMarkdownButton(panel, {
      label: 'Copier',
      tooltip: 'Copier le Canvas',
    });
    expect(second).toBe(first);
    expect(panel.querySelectorAll(`.${CANVAS_MARKDOWN_BUTTON_CLASS}`)).toHaveLength(1);
    expect(second?.getAttribute('aria-label')).toBe('Copier le Canvas');
    expect(second?.getAttribute('arialabel')).toBe('Copier le Canvas');
    expect(second?.querySelector('.label')?.textContent).toBe('Copier');
  });

  it('discovers both Canvas menus in document order and inserts into each owning menu', () => {
    const first = setup();
    document.body.insertAdjacentHTML('beforeend', canvasFixture('immersive-panel', 'second-menu'));
    const second = document.createElement('gem-menu');
    second.id = 'second-menu';
    second.setAttribute('role', 'menu');
    fillMenu(second);
    document.body.append(second);
    const panels = resolveCanvasEntryPanels(document);
    expect(panels).toEqual([first, second]);
    const buttons = panels.map((panel) => injectCanvasCopyMarkdownButton(panel, labels)!);
    expect(buttons.map((button) => button.parentElement)).toEqual([first, second]);
    expect(buttons.map((button) => button.previousElementSibling?.getAttribute('value'))).toEqual([
      'download_md',
      'download_md',
    ]);
  });

  it('removing focused Copy returns focus to the owning Canvas menu across an inner menu', () => {
    const panel = setup();
    const download = panel.querySelector<HTMLElement>('[value="download_md"]')!;
    const button = injectCanvasCopyMarkdownButton(panel, labels)!;
    const inner = document.createElement('div');
    inner.setAttribute('role', 'menu');
    button.before(inner);
    inner.append(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    removeCanvasCopyMarkdownButton(button);

    expect(document.activeElement).toBe(download);
    expect(download.tabIndex).toBe(0);
    expect(panel.querySelectorAll(`.${CANVAS_MARKDOWN_BUTTON_CLASS}`)).toHaveLength(0);
  });
});
