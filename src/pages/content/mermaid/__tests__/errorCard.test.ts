import { afterEach, describe, expect, it } from 'vitest';

import { setCachedLanguage } from '@/utils/i18n';

import { createMermaidErrorCard } from '../codeBlock';

describe('Mermaid syntax error card', () => {
  afterEach(async () => {
    await setCachedLanguage('en');
  });

  it('speaks the Voyager language and keeps the Code button label bold in the hint', async () => {
    await setCachedLanguage('zh');

    const card = createMermaidErrorCard('Parse error on line 2');

    expect(card.textContent).toContain('Mermaid 语法错误');
    expect(card.textContent).toContain('点「代码」查看源码');
    expect(card.querySelector('b')?.textContent).toBe('代码');
  });
});
