import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiTurnPatch } from '../../__tests__/geminiOnlineTurnFixture';
import { geminiDraftPolicy } from '../geminiDraftPolicy';
import { startGeminiDraftSendDetection } from '../geminiDraftSendDetection';

describe('draft deletion keeps packaged turn evidence', () => {
  let stopSelectors: (() => void) | undefined;
  let stopDetection: (() => void) | undefined;

  beforeEach(() => {
    history.replaceState({}, '', '/u/1/app');
    document.body.innerHTML = `<main></main>
      <div class="text-input-field">
        <rich-textarea><div contenteditable="true" id="input">First request</div></rich-textarea>
        <button aria-label="Send" id="send">Send</button>
      </div>`;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 24,
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
  });

  afterEach(() => {
    stopDetection?.();
    stopSelectors?.();
    stopDetection = undefined;
    stopSelectors = undefined;
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('requires a bundled user host before confirming the first send even with online fixes enabled', async () => {
    stopSelectors = await installGeminiTurnPatch({ 'turn.userWithHosts': ['.online-user'] });
    const onSent = vi.fn();
    const detector = startGeminiDraftSendDetection({
      doc: document,
      // This test isolates send evidence from the separate host-admission policy.
      policy: { ...geminiDraftPolicy(), eligible: () => true },
      onSent,
    });
    stopDetection = detector.stop;
    document.getElementById('send')!.click();
    history.pushState({}, '', '/u/1/app/created');
    document.querySelector('main')!.innerHTML = '<div class="online-user">First request</div>';

    detector.checkSent();
    expect(onSent).not.toHaveBeenCalled();

    document.querySelector('.online-user')!.classList.add('user-query-container');
    detector.checkSent();

    expect(onSent).toHaveBeenCalledOnce();
    expect(onSent).toHaveBeenCalledWith('/u/1/app');
  });
});
