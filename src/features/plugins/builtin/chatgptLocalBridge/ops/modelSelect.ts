/**
 * `model.select` (spec §3.4, leased 25 s): the site data and the mode are
 * checked before any page event, then the engine in `chatgptModelSelect`
 * opens the picker, selects, verifies and closes it. The picker exists only
 * in chat mode; ChatGPT Work has a different one the bridge never touches.
 */
import type { ModelSelectParams, ModelSelectResult } from '@/features/bridge/protocol';
import { resolveTarget, selectModel } from '@/features/plugins/builtin/chatgptModelSelect/engine';
import type { SiteAdapter } from '@/features/plugins/types';

import type { OpContext } from '../opContext';
import { readMode, readPageLanguage } from './conversationReady';
import { composerFormOf, findComposerField } from './pageReaders';

export async function runModelSelect(
  ctx: OpContext,
  params: ModelSelectParams,
  adapter: SiteAdapter | null,
): Promise<ModelSelectResult> {
  const data = adapter?.modelPicker;
  if (!data) ctx.fail('unsupported-data', 'This site has no model picker data.');
  const target = resolveTarget(ctx, data, params.target);

  const field = findComposerField(adapter);
  if (!field) ctx.fail('selector-missing', 'The ChatGPT composer was not found.');
  const { mode, labels } = readMode(field, adapter);
  if (mode !== 'chat') {
    ctx.fail(
      mode === 'work' ? 'mode-unavailable' : 'mode-unknown',
      mode === 'work'
        ? 'ChatGPT is in Work mode; models are selected only in chat mode.'
        : 'Could not confirm ChatGPT is in chat mode, so its model menu was not opened.',
      { mode, composerLabels: labels, lang: readPageLanguage() },
    );
  }

  const { previous, ...result } = await selectModel(ctx, data, target, () => {
    const field = findComposerField(adapter);
    return field ? composerFormOf(field) : document;
  });
  return params.capturePrevious ? { ...result, previous } : result;
}
