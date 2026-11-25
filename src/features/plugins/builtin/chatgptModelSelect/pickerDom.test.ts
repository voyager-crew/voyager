import { describe, expect, it } from 'vitest';

import type { ModelPickerSection } from '@/features/plugins/sites/sections/modelPickerData';

import { readStatus, triggerStep } from './pickerDom';

function menuWithStatus(text: string): HTMLElement {
  const menu = document.createElement('div');
  menu.innerHTML = `<span role="status">${text}</span>`;
  return menu;
}

function data(template: string): ModelPickerSection {
  return {
    format: 1,
    triggerLabels: { 'zh-CN': ['选择 ChatGPT 模型'] },
    effortStatus: { 'zh-CN': template },
    models: {},
    presets: {},
  } as ModelPickerSection;
}

describe('readStatus', () => {
  it('reads the step name and leaves the position unknown when the template has no position', () => {
    const status = readStatus(menuWithStatus('Pro，共 5 项。'), data('{label}，共 {count} 项。'));

    expect(status).toMatchObject({ label: 'Pro', position: null });
  });

  it('reads the position when the template names it', () => {
    const status = readStatus(
      menuWithStatus('Pro，第 5 项，共 5 项。'),
      data('{label}，第 {position} 项，共 {count} 项。'),
    );

    expect(status).toMatchObject({ label: 'Pro', position: 5 });
  });
});

describe('triggerStep', () => {
  function trigger(holder: string): HTMLElement {
    const button = document.createElement('button');
    button.innerHTML = `<span aria-hidden="true">思考强度</span><span>${holder}</span>`;
    return button;
  }

  it.each([
    ['the step child after the model name', '6 <span>Extra High</span>', 'Extra High'],
    ['the whole text beside an empty icon', 'Pro<svg></svg>', 'Pro'],
    ['the whole text, never its last words', '6 Extra High<svg></svg>', '6 Extra High'],
  ])('reads %s', (_, inner, step) => {
    const html = `<span data-model-selection-label="gpt-6-pro">${inner}</span>`;

    expect(triggerStep(trigger(html))).toBe(step);
  });

  it('reads the step span after the model name, as chatgpt.com draws Pro under Latest', () => {
    const html =
      '<span class="min-w-0 truncate"><span data-model-selection-label="gpt-6-pro">6</span> <span>Pro</span></span>';

    expect(triggerStep(trigger(html))).toBe('Pro');
  });
});
