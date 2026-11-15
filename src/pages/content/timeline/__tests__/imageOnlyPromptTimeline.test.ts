import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GeminiTimelineTurnSource } from '../GeminiTimelineTurnSource';

/**
 * Live Gemini shape: a text prompt's bubble is `.user-query-bubble-with-background`, and an
 * image-only prompt has no bubble — its `file-preview-container` is the only child of the
 * inner `.user-query-container`.
 */
const CONVERSATION = `<main>
  <div class="conversation-container" id="aaaaaaaaaaaaaaaa">
    <user-query>
      <span class="user-query-container">
        <user-query-content class="user-query-container">
          <div class="user-query-container">
            <div class="file-preview-container"></div>
            <div class="query-content">
              <div class="query-bubble-anchor">
                <span class="user-query-bubble-with-background" data-turn-id="s-9e99131845089e19">
                  <span class="horizontal-container">
                    <div class="query-text">
                      <h5 class="cdk-visually-hidden screen-reader-user-query-label"><span>You said</span></h5>
                      <p class="query-text-line">Describe this</p>
                    </div>
                  </span>
                </span>
              </div>
            </div>
            <div class="luminous-actions-container"></div>
          </div>
        </user-query-content>
      </span>
    </user-query>
  </div>
  <div class="conversation-container" id="bbbbbbbbbbbbbbbb">
    <user-query>
      <span class="user-query-container">
        <user-query-content class="user-query-container">
          <div class="user-query-container">
            <div class="file-preview-container">
              <user-query-file-carousel class="query-file-carousel">
                <div class="scrollable-area">
                  <div>
                    <user-query-file-preview class="query-file-preview">
                      <div class="file-preview-container">
                        <button aria-label="Show the uploaded image in a lightbox" class="preview-image-button">
                          <img data-test-id="uploaded-img" alt="Uploaded image preview" class="preview-image">
                        </button>
                      </div>
                    </user-query-file-preview>
                  </div>
                </div>
              </user-query-file-carousel>
            </div>
          </div>
        </user-query-content>
      </span>
    </user-query>
  </div>
</main>`;

function pinTop(element: HTMLElement, top: number): void {
  element.getBoundingClientRect = () => new DOMRect(0, top, 320, 48);
}

describe('image-only Gemini prompts', () => {
  let source: GeminiTimelineTurnSource | undefined;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = CONVERSATION;
  });

  afterEach(() => {
    source?.stop();
    source = undefined;
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('marks an image-only prompt and keeps the text prompt on its bubble', async () => {
    const bubble = document.querySelector<HTMLElement>('.user-query-bubble-with-background');
    const imageTurn = document.querySelector<HTMLElement>(
      '#bbbbbbbbbbbbbbbb user-query-content > .user-query-container > .file-preview-container',
    );
    if (!bubble || !imageTurn) throw new Error('fixture did not mount both prompts');
    pinTop(bubble, 80);
    pinTop(imageTurn, 400);

    source = new GeminiTimelineTurnSource(false);
    await source.initialize(new AbortController().signal);
    const markers = source.read([]).markers;

    // The image prompt keeps document order without stealing the bubble, named by Gemini's alt text.
    expect(markers.map((marker) => marker.element)).toEqual([bubble, imageTurn]);
    expect(markers.map((marker) => marker.summary)).toEqual([
      'Describe this',
      'Uploaded image preview',
    ]);
    expect(markers.map((marker) => marker.id)).toEqual([
      's-aaaaaaaaaaaaaaaa',
      's-bbbbbbbbbbbbbbbb',
    ]);
  });
});
