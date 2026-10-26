import { locatorSiteForHost } from '@/core/selectors/sites';
import aistudio from '@/features/plugins/catalog/sites/aistudio/selector-data/input-packaged.json';
import chatgpt from '@/features/plugins/catalog/sites/chatgpt/selector-data/input-packaged.json';
import claude from '@/features/plugins/catalog/sites/claude/selector-data/input-packaged.json';
import deepseek from '@/features/plugins/catalog/sites/deepseek/selector-data/input-packaged.json';
import geminiInput from '@/features/plugins/catalog/sites/gemini/selector-data/input-packaged.json';
import geminiVim from '@/features/plugins/catalog/sites/gemini/selector-data/vim-packaged.json';
import kimi from '@/features/plugins/catalog/sites/kimi/selector-data/input-packaged.json';

export type InputSiteId = 'gemini' | 'aistudio' | 'chatgpt' | 'claude' | 'deepseek' | 'kimi';
const INPUT_DATA = {
  gemini: { ...geminiVim, ...geminiInput },
  aistudio,
  chatgpt,
  claude,
  deepseek,
  kimi,
};

/** Host admission is packaged; a locator cannot change which site's data a page reads. */
export function inputSiteId(doc: Document = document): InputSiteId | null {
  const site = locatorSiteForHost(doc.defaultView?.location.hostname ?? doc.location.hostname);
  return site && Object.hasOwn(INPUT_DATA, site) ? (site as InputSiteId) : null;
}

const STANDARD_INPUTS = ['[contenteditable="true"][role="textbox"]', 'textarea'];
const STANDARD_EDITABLE = ['input, textarea, select, [contenteditable="true"], [role="textbox"]'];

export function packagedSiteInputSelectors(
  site: InputSiteId | null,
  key: string,
): readonly string[] {
  if (!site) {
    if (key === 'vim.editable') return STANDARD_EDITABLE;
    if (key === 'input.candidates') return STANDARD_INPUTS;
    return [':not(*)'];
  }
  const data: Readonly<Record<string, unknown>> = INPUT_DATA[site];
  const list = data[key];
  return Array.isArray(list) ? (list as readonly string[]) : [':not(*)'];
}

export function packagedInputSelectors(key: string, doc: Document = document): readonly string[] {
  return packagedSiteInputSelectors(inputSiteId(doc), key);
}

export function packagedInputSelector(key: string, doc: Document = document): string {
  return packagedInputSelectors(key, doc).join(',');
}
