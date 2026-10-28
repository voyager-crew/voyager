import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { findGeneratedPreviewImages } from '../generatedImageTargets';
import { createImageHealthMonitor } from '../imageHealth';

let retire: (() => void) | undefined;

// Captured Gemini shape: the image-opening button is separate from the native download.
function card(): HTMLElement {
  const host = document.createElement('generated-image');
  host.innerHTML = `<single-image _ngcontent-ng-c2="" _nghost-ng-c3="" class="generated-image large"><div _ngcontent-ng-c3="" class="image-container"><button _ngcontent-ng-c3="" class="image-button" jslog="1;track:generic_click" aria-label="Open image"><img _ngcontent-ng-c3="" class="image loaded" src="https://lh3.googleusercontent.com/gg/abc=s1024" alt=", AI generated"></button><div class="generated-image-controls"><download-generated-image-button _nghost-ng-c4=""><button data-test-id="download-generated-image-button" aria-label="Download full size image"><mat-icon fonticon="download" data-mat-icon-name="download" class="google-symbols"></mat-icon></button></download-generated-image-button></div></div></single-image>`;
  document.body.append(host);
  return host;
}

beforeEach(() => {
  setPageUrl('https://gemini.google.com/');
});

afterEach(() => {
  retire?.();
  retire = undefined;
  document.body.replaceChildren();
  resetPageUrl();
  vi.restoreAllMocks();
});

it('unrelated page images do not incur generated-owner traversal during the preview scan', () => {
  const generated = card();
  const unrelated = document.createElement('img');
  unrelated.src = 'https://example.com/avatar.png';
  document.body.prepend(unrelated);
  const traversal = vi.spyOn(unrelated, 'closest');

  expect(findGeneratedPreviewImages(document)).toEqual([generated.querySelector('img')]);
  expect(traversal).not.toHaveBeenCalled();
});

it('an online container patch cannot skip the health check for a detached generated-image button', async () => {
  const host = card();
  const image = host.querySelector('img')!;
  const button = host.querySelector<HTMLButtonElement>('download-generated-image-button button')!;
  const clean = document.createElement('img');
  clean.src = 'data:image/png;base64,Y2xlYW4=';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    let drawn: CanvasImageSource;
    return {
      drawImage: (source: CanvasImageSource) => {
        drawn = source;
      },
      getImageData: () => {
        if (drawn === image) throw new DOMException('tainted', 'SecurityError');
        return { data: new Uint8ClampedArray(32 * 32 * 4).fill(128) };
      },
    } as unknown as CanvasRenderingContext2D;
  });
  host.remove();
  const bundledFetch = vi.fn(async () => clean);
  const bundled = await createImageHealthMonitor(bundledFetch).capturePreview(button);
  const oldPatch = {
    'generatedImage.container': ['generated-media'],
    'generatedImage.downloadIcon': ['[fonticon="download"]'],
  };
  retire = await installGeminiSelectorPatch(oldPatch);
  const onlineFetch = vi.fn(async () => clean);
  const online = await createImageHealthMonitor(onlineFetch).capturePreview(button);

  expect(bundled).not.toBeNull();
  expect(online).toEqual(bundled);
  expect(onlineFetch).toHaveBeenCalledExactlyOnceWith(image.src);
});
