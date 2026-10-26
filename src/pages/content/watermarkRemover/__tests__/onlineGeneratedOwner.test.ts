// @vitest-environment-options { "url": "https://gemini.google.com/app/images" }
import { afterEach, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import {
  findGeneratedPreviewImages,
  findGeneratedPreviewForButton,
} from '../generatedImageTargets';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
});
function page(native = true): HTMLButtonElement {
  const tag = native ? 'generated-image' : 'generated-media';
  document.body.innerHTML = `<model-response><${tag} class="card"><single-image><button aria-label="Open image"><img src="https://lh3.googleusercontent.com/gg/original=s1024"></button><download-generated-image-button><button id="download" data-test-id="download-generated-image-button"><mat-icon fonticon="download"></mat-icon></button></download-generated-image-button></single-image></${tag}></model-response>`;
  return document.querySelector('#download')!;
}
async function online() {
  stop = await installGeminiSelectorPatch({ 'generatedImage.container': ['.card'] });
}
it('the same generated image stays paired to the same download through bundled and remote owners', async () => {
  const button = page();
  const before = findGeneratedPreviewForButton(button);
  const previews = findGeneratedPreviewImages(document);
  await online();
  expect(findGeneratedPreviewForButton(button)).toBe(before);
  expect(findGeneratedPreviewImages(document)).toEqual(previews);
  expect(before?.src).toBe('https://lh3.googleusercontent.com/gg/original=s1024');
});
it('a renamed image card recovers its preview inside Gemini’s image-opening button', async () => {
  const button = page(false);
  await online();
  expect(findGeneratedPreviewForButton(button)).toBe(document.querySelector('img'));
  expect(findGeneratedPreviewImages(document)).toEqual([document.querySelector('img')]);
});
it('a card cannot borrow a generated download control for a second image', async () => {
  const button = page(false);
  const extra = document.createElement('img');
  extra.src = 'https://lh3.googleusercontent.com/upload.png';
  document.querySelector('.card')!.prepend(extra);
  await online();
  const rejected = findGeneratedPreviewForButton(button);
  extra.remove();
  expect([rejected, findGeneratedPreviewForButton(button)]).toEqual([
    null,
    document.querySelector('img'),
  ]);
});
it('a foreign URL containing a Google hostname cannot become the generated preview', async () => {
  const button = page(false);
  const image = document.querySelector('img')!;
  image.src = 'https://googleusercontent.com.wrong.example/gg/image';
  await online();
  const rejected = findGeneratedPreviewForButton(button);
  image.src = 'https://lh3.googleusercontent.com/gg/original=s1024';
  expect([rejected, findGeneratedPreviewForButton(button)]).toEqual([null, image]);
});
it('an upload card outside the assistant reply cannot become generated output', async () => {
  const button = page(false);
  const card = document.querySelector('.card')!;
  document.body.append(card);
  await online();
  const rejected = findGeneratedPreviewForButton(button);
  document.querySelector('model-response')!.append(card);
  expect([rejected, findGeneratedPreviewForButton(button)]).toEqual([
    null,
    document.querySelector('img'),
  ]);
});
it('an unrelated button in a repaired card cannot select the generated preview for downloading', async () => {
  const button = page(false);
  const open = document.querySelector<HTMLButtonElement>('[aria-label="Open image"]')!;
  await online();
  expect([findGeneratedPreviewForButton(open), findGeneratedPreviewForButton(button)]).toEqual([
    null,
    document.querySelector('img'),
  ]);
});

it('an image card without a native generated download cannot certify its own image provenance', async () => {
  const button = page(false);
  const nativeHost = button.parentElement!;
  nativeHost.replaceWith(button);
  button.removeAttribute('data-test-id');
  await online();
  const rejected = findGeneratedPreviewImages(document);
  button.setAttribute('data-test-id', 'download-generated-image-button');
  expect([rejected, findGeneratedPreviewImages(document)]).toEqual([
    [],
    [document.querySelector('img')],
  ]);
});
