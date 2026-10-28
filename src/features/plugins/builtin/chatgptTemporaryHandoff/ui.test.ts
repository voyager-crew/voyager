import { afterEach, describe, expect, it } from 'vitest';

import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { setCachedLanguage } from '@/utils/i18n';

import { getTemporaryHandoffCopy } from './i18n';
import { showHandoffConfirmation } from './ui';

describe('temporary handoff confirmation credit', () => {
  const scopes: PluginScope[] = [];

  afterEach(async () => {
    await Promise.all(scopes.splice(0).map((scope) => scope.dispose()));
    await setCachedLanguage('en');
    document.body.innerHTML = '';
  });

  it('keeps the project name whole when the language puts it first', async () => {
    await setCachedLanguage('ja');
    const scope = new PluginScope();
    scopes.push(scope);

    void showHandoffConfirmation(scope, getTemporaryHandoffCopy('ja'));

    const credit = document.querySelector<HTMLAnchorElement>(
      '.gv-chatgpt-handoff-dialog-attribution',
    );
    expect(credit?.textContent).toBe('ChatGPT Voyager で動作');
    expect(credit?.href).toBe('https://github.com/TanChuping/chatgpt-voyager');
    // Narrow dialogs hide the words around the name, leaving only the name.
    expect(
      credit?.querySelector('.gv-chatgpt-handoff-dialog-attribution-suffix')?.textContent,
    ).toBe(' で動作');
  });
});
