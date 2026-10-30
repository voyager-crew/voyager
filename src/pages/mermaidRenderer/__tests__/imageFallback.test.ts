import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMermaidImageFallback } from '../imageFallback';

const EXTENSION_BASE = 'chrome-extension://test-extension-id/';
const REMOTE_IMAGE = 'https://attacker.example/pixel.png';
const INLINE_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

let renderer: JSDOM;

beforeEach(() => {
  renderer = new JSDOM('', { url: `${EXTENSION_BASE}src/pages/mermaidRenderer/index.html` });
});

afterEach(() => {
  vi.restoreAllMocks();
  renderer.window.close();
});

describe('image fallback in the dedicated renderer document', () => {
  it('replaces remote and relative image URLs before they reach native setters', () => {
    const prototype = renderer.window.HTMLImageElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'src');
    const nativeSetter = descriptor?.set;
    if (!nativeSetter) throw new Error('jsdom has no native image source setter');
    const sourceSink = vi.fn(function (this: HTMLImageElement, value: unknown) {
      nativeSetter.call(this, value);
    });
    Object.defineProperty(prototype, 'src', { ...descriptor, set: sourceSink });
    const attributeSink = vi.spyOn(renderer.window.Element.prototype, 'setAttribute');
    const namespacedSink = vi.spyOn(renderer.window.Element.prototype, 'setAttributeNS');
    installMermaidImageFallback(renderer.window.document, EXTENSION_BASE);

    for (const source of [
      REMOTE_IMAGE,
      '//attacker.example/pixel.png',
      'avatar',
      '/avatar',
      'chrome-extension://another-extension-id/icon-32.png',
      'blob:https://gemini.google.com/local-image',
      '#local-image',
    ]) {
      const image = new renderer.window.Image();
      image.src = source;
      expect(sourceSink).toHaveBeenLastCalledWith(INLINE_IMAGE);
      expect(image.getAttribute('src')).toBe(INLINE_IMAGE);
      image.setAttribute('SRC', source);
      expect(attributeSink).toHaveBeenLastCalledWith('SRC', INLINE_IMAGE);
      expect(image.getAttribute('src')).toBe(INLINE_IMAGE);
      image.setAttributeNS(null, 'src', source);
      expect(namespacedSink).toHaveBeenLastCalledWith(null, 'src', INLINE_IMAGE);
      expect(image.getAttribute('src')).toBe(INLINE_IMAGE);
    }
  });

  it('preserves inline and explicit own-extension image sources', () => {
    installMermaidImageFallback(renderer.window.document, EXTENSION_BASE);
    for (const source of [INLINE_IMAGE, `${EXTENSION_BASE}icon-32.png`, '']) {
      const image = new renderer.window.Image();
      image.src = source;
      expect(image.getAttribute('src')).toBe(source);
      image.setAttribute('src', source);
      expect(image.getAttribute('src')).toBe(source);
      image.setAttributeNS(null, 'src', source);
      expect(image.getAttribute('src')).toBe(source);
    }
  });

  it('leaves host images and DOM sink implementations untouched', () => {
    const beforeSource = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const beforeAttribute = HTMLImageElement.prototype.setAttribute;
    installMermaidImageFallback(renderer.window.document, EXTENSION_BASE);
    // Calling the helper with the host document must also be harmless.
    installMermaidImageFallback(document, EXTENSION_BASE);
    const image = new Image();
    image.src = REMOTE_IMAGE;
    expect(image.getAttribute('src')).toBe(REMOTE_IMAGE);
    image.setAttribute('src', 'avatar');
    expect(image.getAttribute('src')).toBe('avatar');
    expect(Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')).toEqual(
      beforeSource,
    );
    expect(HTMLImageElement.prototype.setAttribute).toBe(beforeAttribute);
    const unrelated = renderer.window.document.createElement('div');
    unrelated.setAttribute('src', REMOTE_IMAGE);
    expect(unrelated.getAttribute('src')).toBe(REMOTE_IMAGE);
  });
});
