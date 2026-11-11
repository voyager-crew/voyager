import { describe, expect, it } from 'vitest';

import { readContentStyle } from '@/tests/contentStyle';

/**
 * Declarations of the top-level rule whose selector list is exactly `selector`.
 * Anchored at a line start and closed by its own `}`, so neither a later rule
 * nor an indented `@media` copy of the selector can satisfy an assertion.
 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*{([^}]*)}`))?.[1] ?? '';
}

describe('selection mode interaction', () => {
  it('pins the selection bar to the top', () => {
    const css = readContentStyle();

    expect(ruleBody(css, '.gv-export-select-bar')).toMatch(/\btop:\s*12px;/);
  });

  it('paints the export dialog and selection bar from the scheme-following ui tokens', () => {
    const css = readContentStyle();

    for (const selector of ['.gv-export-dialog', '.gv-export-select-bar']) {
      const block = ruleBody(css, selector);
      expect(block).toMatch(/background:[^;]*var\(--gv-ui-surface\)/);
      expect(block).toMatch(/color:[^;]*var\(--gv-ui-text\)/);
      expect(block).toMatch(/font-family:\s*var\(--gv-ui-font\);/);
    }
  });

  it('starts the Markdown prompt heading switch knob on the right in RTL layouts', () => {
    const css = readContentStyle();
    const knobBlock = ruleBody(
      css,
      'body.gv-rtl .gv-export-dialog .gv-export-prompt-heading-switch .gv-coach-knob',
    );

    expect(knobBlock).toMatch(/\bright:\s*2px;/);
    expect(knobBlock).toContain('left: auto;');
  });

  it('keeps logo wrapper from blocking top-bar button clicks', () => {
    const css = readContentStyle();
    const wrapperBlock = ruleBody(css, '.gv-logo-dropdown-wrapper');
    const logoBlock = ruleBody(
      css,
      ".gv-logo-dropdown-wrapper [data-test-id='logo'], .gv-logo-dropdown-wrapper .logo",
    );

    expect(wrapperBlock).toContain('pointer-events: none;');
    expect(wrapperBlock).toContain('width: fit-content;');
    expect(logoBlock).toContain('pointer-events: auto;');
  });

  it('applies horizontal scrolling to the export selection bar and prevents text wrapping', () => {
    const css = readContentStyle();

    // Check for container scroll behaviors
    const barBlock = ruleBody(css, '.gv-export-select-bar');
    expect(barBlock).toContain('overflow-x: auto;');
    expect(barBlock).toContain('scrollbar-width: none;');

    // Check for nowrapping and no shrinking on buttons
    const btnBlock = ruleBody(
      css,
      '.gv-export-select-all-toggle, .gv-export-select-role-btn, .gv-export-select-export-btn, .gv-export-select-cancel-btn',
    );
    expect(btnBlock).toContain('white-space: nowrap;');
    expect(btnBlock).toContain('flex-shrink: 0;');
  });
});
