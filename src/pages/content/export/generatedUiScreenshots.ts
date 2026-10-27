/**
 * Screenshots of Gemini's generated-UI iframes for rich exports.
 *
 * Exports cannot read the cross-origin `gemini-code-immersive` iframes, so the
 * background captures the visible tab and this module crops each frame out of
 * it and inserts the image next to the frame. The inserted sections are part of
 * the live DOM only while an export runs; callers remove them afterwards.
 */

import { LAYER_ATTR } from '@/core/ui/layer';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/generated-ui-packaged.json';

const GENERATED_UI_FRAME_SELECTOR = packaged['generatedUi.frames'];
const GENERATED_UI_SCREENSHOT_MESSAGE_TYPE = 'gv.generatedUi.captureVisibleTab';
const GENERATED_UI_CAPTURE_PERMISSION_MESSAGE_TYPE = 'gv.generatedUi.ensureCapturePermission';
const GENERATED_UI_SCREENSHOT_SECTION_CLASS = 'gv-generated-ui-screenshot-section';

/** Remove inserted screenshots, except those already moved into the PDF print container. */
export function removeGeneratedUiScreenshotSections(): void {
  document.querySelectorAll(`.${GENERATED_UI_SCREENSHOT_SECTION_CLASS}`).forEach((el) => {
    // PDFPrintService owns the print container lifecycle after window.print().
    if (el.closest('#gv-pdf-print-container')) return;
    el.remove();
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = src;
  });
}

async function cropViewportScreenshot(dataUrl: string, rect: DOMRect): Promise<string | null> {
  const img = await loadImage(dataUrl);
  const scaleX = img.naturalWidth / window.innerWidth;
  const scaleY = img.naturalHeight / window.innerHeight;
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  const width = Math.floor((right - left) * scaleX);
  const height = Math.floor((bottom - top) * scaleY);
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(img, left * scaleX, top * scaleY, width, height, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

function insertGeneratedUiScreenshot(frame: HTMLIFrameElement, dataUrl: string): void {
  const section = document.createElement('div');
  section.className = GENERATED_UI_SCREENSHOT_SECTION_CLASS;
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Gemini interactive UI screenshot';
  section.appendChild(img);

  const anchor =
    (frame.closest(packaged['generatedUi.attachment']) as HTMLElement | null) ||
    (frame.closest(packaged['generatedUi.response']) as HTMLElement | null);
  if (anchor?.parentElement) {
    anchor.insertAdjacentElement('afterend', section);
    return;
  }

  const container =
    (frame.closest(packaged['generatedUi.message']) as HTMLElement | null)?.querySelector(
      packaged['generatedUi.markdown'],
    ) ||
    (frame.closest(packaged['generatedUi.container']) as HTMLElement | null) ||
    frame.parentElement;
  container?.appendChild(section);
}

async function captureVisibleTab(): Promise<string | null> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: GENERATED_UI_SCREENSHOT_MESSAGE_TYPE,
    })) as { ok?: boolean; dataUrl?: string; error?: string };
    if (response?.ok && typeof response.dataUrl === 'string') return response.dataUrl;
    console.warn(
      '[Gemini Voyager] Generated UI screenshot capture failed:',
      response?.error || 'empty_response',
      response,
    );
  } catch (error) {
    console.warn('[Gemini Voyager] Generated UI screenshot capture failed:', error);
  }
  return null;
}

/**
 * Ask the background for tab-capture permission when the page has generated UI.
 *
 * Must be the first await of a click handler: the browser only grants the
 * permission while the user gesture is still active. Never throws.
 */
export async function ensureGeneratedUiScreenshotPermission(): Promise<void> {
  if (!document.querySelector(GENERATED_UI_FRAME_SELECTOR)) return;
  try {
    // Must run from export click handlers, before preload/capture awaits erase the gesture.
    const response = (await chrome.runtime.sendMessage({
      type: GENERATED_UI_CAPTURE_PERMISSION_MESSAGE_TYPE,
    })) as { ok?: boolean };
    if (!response?.ok) {
      console.warn('[Gemini Voyager] Generated UI screenshot permission was not granted.');
    }
  } catch (error) {
    console.warn('[Gemini Voyager] Generated UI screenshot permission request failed:', error);
  }
}

/**
 * Replace any earlier screenshots with fresh ones for every generated-UI frame.
 *
 * Scrolls each frame into view and hides Voyager's layers (the export progress
 * toast among them) while capturing so they are not in the shot. Never throws: a failed capture leaves
 * the frame's link/text fallback for the exporter.
 */
export async function captureGeneratedUiScreenshots(): Promise<void> {
  removeGeneratedUiScreenshotSections();
  const frames = Array.from(
    document.querySelectorAll<HTMLIFrameElement>(GENERATED_UI_FRAME_SELECTOR),
  );
  if (frames.length === 0) return;

  const hiddenLayers = Array.from(document.querySelectorAll<HTMLElement>(`[${LAYER_ATTR}]`));
  // Visibility, not display: a layer host's own `display` is `!important` inside its shadow root.
  hiddenLayers.forEach((layer) => layer.style.setProperty('visibility', 'hidden', 'important'));

  try {
    for (const frame of frames) {
      frame.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const screenshot = await captureVisibleTab();
      if (!screenshot) continue;
      const rect = frame.getBoundingClientRect();
      const cropped = await cropViewportScreenshot(screenshot, rect);
      if (cropped) {
        insertGeneratedUiScreenshot(frame, cropped);
      } else {
        console.warn('[Gemini Voyager] Generated UI screenshot crop failed:', {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          width: rect.width,
        });
      }
    }
  } catch (error) {
    console.warn('[Gemini Voyager] Generated UI screenshot export failed:', error);
    // Link/text fallback still exports if screenshot capture is unavailable.
  } finally {
    hiddenLayers.forEach((layer) => layer.style.removeProperty('visibility'));
  }
}
