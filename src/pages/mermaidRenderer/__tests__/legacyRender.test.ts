import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderMermaidDocument } from '../render';

// Match the Firefox build alias while exercising the same document renderer.
vi.mock('mermaid', async () => ({ default: (await import('mermaid-legacy')).default }));

beforeEach(() => {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 80, height: 20 }),
  });
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
    configurable: true,
    value: () => 80,
  });
});

afterEach(() => {
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
  Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength');
  document.body.replaceChildren();
});

describe('Firefox Mermaid 9 renderer document', () => {
  it.each(['light', 'dark'] as const)(
    'returns sanitized SVG and a light export in %s',
    async (theme) => {
      const result = await renderMermaidDocument({
        id: 'mermaid-firefox',
        code: 'flowchart TD\n  Start --> Middle\n  Middle --> Done',
        theme,
        lightExport: true,
      });

      expect(result?.errorMessage).toBeNull();
      expect(result?.theme).toBe(theme);
      const template = document.createElement('template');
      template.innerHTML = result!.svg;
      expect(
        Array.from(template.content.querySelectorAll('text'), (text) => text.textContent),
      ).toContain('Start');
      expect(template.content.querySelector('svg')?.getAttribute('style')).toContain('system-ui');
      expect(template.content.querySelector('a, img, image, script')).toBeNull();
      if (theme === 'dark') {
        expect(result?.lightExportSvg).toContain('<svg');
        expect(result?.lightExportSvg).not.toBe(result?.svg);
      } else {
        expect(result?.lightExportSvg).toBeNull();
      }
    },
  );
});
