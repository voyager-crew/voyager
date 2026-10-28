import { afterEach, beforeEach, expect, it } from 'vitest';

import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { findNativeDownloadButton } from '../downloadButton';
import { findGeneratedDownloadIcon } from '../generatedImageTargets';

let retire: (() => void) | undefined;

beforeEach(() => {
  setPageUrl('https://gemini.google.com/');
  document.body.replaceChildren();
});
afterEach(() => {
  retire?.();
  retire = undefined;
  document.body.replaceChildren();
  resetPageUrl();
});

it('a remote icon cannot turn a neighbouring share control into a generated download', async () => {
  const host = document.createElement('generated-image');
  host.innerHTML =
    '<button id="share"><mat-icon fonticon="share"></mat-icon></button><button id="download"><mat-icon fonticon="download"></mat-icon></button>';
  document.body.append(host);
  retire = await installGeminiSelectorPatch({ 'generatedImage.downloadIcon': ['mat-icon'] });
  expect(findGeneratedDownloadIcon(host)).toBe(host.querySelector('#download mat-icon'));
  expect(findNativeDownloadButton(host.querySelector('#share mat-icon'))).toBeNull();
  expect(findNativeDownloadButton(host.querySelector('#download mat-icon'))).toBe(
    host.querySelector('#download'),
  );
});

it('a renamed Angular icon repairs the original button without changing the generated-image admission', async () => {
  const host = document.createElement('generated-image');
  host.innerHTML =
    '<gem-icon-button _nghost-ng-c80><button><gem-symbol _ngcontent-ng-c80 fonticon="download" jslog="123" aria-hidden="true"></gem-symbol></button></gem-icon-button>';
  document.body.append(host);
  const icon = host.querySelector('gem-symbol')!;
  expect(findNativeDownloadButton(icon)).toBeNull();
  retire = await installGeminiSelectorPatch({
    'generatedImage.downloadIcon': ['gem-symbol[fonticon="download"]'],
  });
  expect(findNativeDownloadButton(icon)).toBe(host.querySelector('button'));
  const upload = document.createElement('user-query-file-preview');
  upload.innerHTML = host.innerHTML;
  document.body.append(upload);
  expect(findNativeDownloadButton(upload.querySelector('gem-symbol'))).toBeNull();
});

it('a standalone native icon cannot decorate the button outside its query root', async () => {
  const host = document.createElement('generated-image');
  host.innerHTML =
    '<button><icon-wrapper><gem-symbol fonticon="download"></gem-symbol></icon-wrapper></button>';
  document.body.append(host);
  const wrapper = host.querySelector('icon-wrapper')!;
  retire = await installGeminiSelectorPatch({ 'generatedImage.downloadIcon': ['gem-symbol'] });
  expect(findGeneratedDownloadIcon(wrapper)).toBeNull();
  expect(findGeneratedDownloadIcon(host)).toBe(host.querySelector('gem-symbol'));
});
