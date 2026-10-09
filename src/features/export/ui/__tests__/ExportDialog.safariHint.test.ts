import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportDialog } from '../ExportDialog';

function setUserAgentVendor(userAgent: string, vendor: string): void {
  Object.defineProperty(globalThis.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  });
  Object.defineProperty(globalThis.navigator, 'vendor', {
    value: vendor,
    configurable: true,
  });
}

describe('ExportDialog (Safari hint)', () => {
  const baseOptions = {
    onExport: vi.fn(),
    onCancel: vi.fn(),
    translations: {
      title: 'Export',
      selectFormat: 'Select',
      warning: 'Warning',
      safariCmdpHint: 'Safari tip: press ⌘P.',
      safariMarkdownHint: 'Safari tip: use PDF.',
      cancel: 'Cancel',
      export: 'Export',
      fontSizeLabel: 'Font Size',
      fontSizePreview: 'The quick brown fox jumps over the lazy dog.',
      imageWidthLabel: 'Image Width',
      imageWidthNarrow: 'Narrow',
      imageWidthMedium: 'Medium',
      imageWidthWide: 'Wide',
      promptHeadingLabel: 'Use prompts as turn headings',
      promptHeadingHint: 'Put each prompt in its turn heading.',
      formatDescriptions: {
        json: 'JSON desc',
        markdown: 'MD desc',
        pdf: 'PDF desc',
        image: 'Image desc',
      },
    },
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('appends ⌘P hint to PDF option description on Safari', () => {
    setUserAgentVendor(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Apple Computer, Inc.',
    );

    const dialog = new ExportDialog();
    dialog.show(baseOptions);

    const pdfRadio = document.querySelector(
      'input[type="radio"][name="export-format"][value="pdf"]',
    ) as HTMLInputElement | null;
    expect(pdfRadio).not.toBeNull();

    const pdfOption = pdfRadio?.closest('.gv-export-format-option') as HTMLElement | null;
    expect(pdfOption).not.toBeNull();

    const desc = pdfOption?.querySelector('.gv-export-format-description') as HTMLElement | null;
    expect(desc?.textContent || '').toContain(baseOptions.translations.safariCmdpHint);
  });

  it('does not append ⌘P hint on non-Safari browsers', () => {
    setUserAgentVendor(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Google Inc.',
    );

    const dialog = new ExportDialog();
    dialog.show(baseOptions);

    const pdfRadio = document.querySelector(
      'input[type="radio"][name="export-format"][value="pdf"]',
    ) as HTMLInputElement | null;
    expect(pdfRadio).not.toBeNull();

    const pdfOption = pdfRadio?.closest('.gv-export-format-option') as HTMLElement | null;
    const desc = pdfOption?.querySelector('.gv-export-format-description') as HTMLElement | null;
    expect(desc?.textContent || '').not.toContain(baseOptions.translations.safariCmdpHint);
  });

  it('appends warning hint to Markdown option description on Safari', () => {
    setUserAgentVendor(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Apple Computer, Inc.',
    );

    const dialog = new ExportDialog();
    dialog.show(baseOptions);

    const mdRadio = document.querySelector(
      'input[type="radio"][name="export-format"][value="markdown"]',
    ) as HTMLInputElement | null;
    expect(mdRadio).not.toBeNull();

    const mdOption = mdRadio?.closest('.gv-export-format-option') as HTMLElement | null;
    const desc = mdOption?.querySelector('.gv-export-format-description') as HTMLElement | null;
    expect(desc?.textContent || '').toContain(baseOptions.translations.safariMarkdownHint);
  });

  it('appends warning hint to image option description on Safari', () => {
    setUserAgentVendor(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Apple Computer, Inc.',
    );

    const dialog = new ExportDialog();
    dialog.show(baseOptions);

    const imageRadio = document.querySelector(
      'input[type="radio"][name="export-format"][value="image"]',
    ) as HTMLInputElement | null;
    expect(imageRadio).not.toBeNull();

    const imageOption = imageRadio?.closest('.gv-export-format-option') as HTMLElement | null;
    const desc = imageOption?.querySelector('.gv-export-format-description') as HTMLElement | null;
    expect(desc?.textContent || '').toContain(baseOptions.translations.safariMarkdownHint);
  });
});
