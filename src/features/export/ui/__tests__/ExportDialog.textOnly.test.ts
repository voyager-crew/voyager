import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportDialog, type ExportDialogOptions } from '../ExportDialog';

const translations: ExportDialogOptions['translations'] = {
  title: 'Export',
  selectFormat: 'Select format',
  warning: '',
  safariCmdpHint: 'Safari tip',
  safariMarkdownHint: 'Safari markdown tip',
  cancel: 'Cancel',
  export: 'Export',
  fontSizeLabel: 'Font Size',
  fontSizePreview: 'Preview',
  imageWidthLabel: 'Image Width',
  imageWidthNarrow: 'Narrow',
  imageWidthMedium: 'Medium',
  imageWidthWide: 'Wide',
  promptHeadingLabel: 'Use prompts as turn headings',
  promptHeadingHint: 'Put each prompt in its turn heading.',
  textOnlyLabel: 'Text only',
  textOnlyHint: 'Leave out images, so the export is a single .md file.',
  formatRecommended: 'Recommended',
  formatDescriptions: { json: 'JSON', markdown: 'Markdown', pdf: 'PDF', image: 'Image' },
};

const section = () => document.querySelector<HTMLElement>('.gv-export-text-only-section');
const exportButton = () =>
  document.querySelector<HTMLButtonElement>('.gv-export-dialog-btn-primary')!;

function selectFormat(format: string): void {
  const radio = document.querySelector<HTMLInputElement>(`input[value="${format}"]`)!;
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
}

describe('ExportDialog text-only switch', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is off by default and passes the choice for Markdown', () => {
    const onExport = vi.fn();
    new ExportDialog().show({
      onExport,
      onCancel: () => {},
      showTextOnlyOption: true,
      translations,
    });

    const toggle = section()?.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(section()?.style.display).toBe('flex');
    expect(section()?.textContent).toContain('Text only');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');

    toggle?.click();
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    exportButton().click();

    expect(onExport).toHaveBeenCalledWith(
      'markdown',
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      true,
    );
  });

  it('hides for other formats and does not pass the choice there', () => {
    const onExport = vi.fn();
    new ExportDialog().show({
      onExport,
      onCancel: () => {},
      showTextOnlyOption: true,
      translations,
    });
    section()?.querySelector<HTMLButtonElement>('[role="switch"]')?.click();

    selectFormat('pdf');
    expect(section()?.style.display).toBe('none');
    exportButton().click();

    expect(onExport).toHaveBeenCalledWith('pdf', 11, undefined, undefined);
  });

  it('stays hidden where the caller does not offer it', () => {
    new ExportDialog().show({ onExport: () => {}, onCancel: () => {}, translations });
    expect(section()?.style.display).toBe('none');
    selectFormat('json');
    selectFormat('markdown');
    expect(section()?.style.display).toBe('none');
  });
});
