// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { afterEach, expect, it } from 'vitest';

import { getGeminiSelectorView } from '@/core/gemini/selectors';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { DefaultStarView } from '../defaultStarView';
import { ModelPickerDom } from '../modelPickerDom';

let retire = () => {};
let stop = () => {};
afterEach(() => {
  stop();
  retire();
  document.body.replaceChildren();
});

it.each([
  { description: 'native button row', tag: 'button', outer: 'section', accept: true },
  { description: 'native custom row', tag: 'gem-menu-item', outer: 'section', accept: true },
  { description: 'unproved ARIA row', tag: 'div', outer: 'section', accept: false },
  { description: 'row nested in another action', tag: 'button', outer: 'a', accept: false },
  { description: 'row nested in copied code', tag: 'button', outer: 'pre', accept: false },
])(
  'the $description keeps stars within the supported native decoration boundary',
  async ({ tag, outer, accept }) => {
    const wrapper = document.createElement(outer);
    if (wrapper instanceof HTMLAnchorElement) wrapper.href = '/another-chat';
    const item = document.createElement(tag);
    item.setAttribute('role', 'menuitem');
    item.setAttribute('data-mode-id', 'fast');
    item.innerHTML = '<div class="label-container" id="bundled"></div><div id="remote"></div>';
    wrapper.append(item);
    document.body.append(wrapper);
    retire = await installGeminiSelectorPatch({ 'modelPicker.modelTitleContainer': ['#remote'] });
    const view = new DefaultStarView();
    stop = () => view.stop();
    view.start();
    const star = view.createStar('model', async () => {});
    view.appendStar(
      item,
      star,
      new ModelPickerDom(getGeminiSelectorView()).starAnchor(item, 'model'),
    );
    expect(star.parentElement).toBe(document.getElementById(accept ? 'remote' : 'bundled'));
  },
);
