import { afterEach, describe, expect, it } from 'vitest';

import { setCachedLanguage } from '@/utils/i18n';

import { setDiagramToolbarButton } from '../diagramToolbar';

afterEach(() => {
  setCachedLanguage('en');
  document.body.replaceChildren();
});

describe('diagram toolbar buttons', () => {
  it('a rendered toolbar switches language when the Voyager language changes', () => {
    setCachedLanguage('zh');
    const diagram = document.createElement('button');
    const code = document.createElement('button');
    const fullscreen = document.createElement('button');
    setDiagramToolbarButton(diagram, 'echarts');
    setDiagramToolbarButton(code, 'code');
    setDiagramToolbarButton(fullscreen, 'fullscreen');
    document.body.append(diagram, code, fullscreen);
    expect([diagram.textContent, code.textContent]).toEqual(['图表', '代码']);

    setCachedLanguage('en');

    expect([diagram.textContent, code.textContent]).toEqual(['Diagram', 'Code']);
    expect(fullscreen.getAttribute('aria-label')).toBe('Fullscreen');
    expect(fullscreen.textContent).toBe('');
    expect(diagram.querySelector('svg.lucide-chart-column')).not.toBeNull();
  });
});
