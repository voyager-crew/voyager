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
    const names = () =>
      [diagram, code, fullscreen].map((button) => button.getAttribute('aria-label'));
    expect(names()).toEqual(['图表', '代码', '全屏']);

    setCachedLanguage('en');

    expect(names()).toEqual(['Diagram', 'Code', 'Fullscreen']);
    // Icon-only: the label is the tooltip and accessible name, never visible text.
    expect(code.title).toBe('Code');
    expect(code.textContent).toBe('');
    expect(diagram.querySelector('svg.lucide-chart-column')).not.toBeNull();
  });
});
