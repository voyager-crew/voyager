/** Gemini's response chain, including Angular and presentation attributes from the live host. */
export function geminiAnswerChain(content: string): string {
  return `<model-response><div _ngcontent-ng-c1><response-container _ngcontent-ng-c1 _nghost-ng-c2 jslog="response">
    <div class="response-container" _ngcontent-ng-c2 jslog="container">
      <div class="presented-response-container" _ngcontent-ng-c2 jslog="presented">
        <div class="response-container-content"><div class="response-content" highlighttoaskhost>
          <model-response-content _nghost-ng-c3><structured-content-container class="model-response-text" _nghost-ng-c4 style="display: block">
            <div class="container"><message-content _ngcontent-ng-c4 _nghost-ng-c5 id="message">
              <div class="markdown markdown-main-panel md-content" _ngcontent-ng-c5 inline-copy-host id="answer" aria-busy="false" aria-live="polite" dir="ltr" style="display: block">${content}</div>
            </message-content></div>
          </structured-content-container></model-response-content>
        </div></div>
      </div>
    </div>
  </response-container></div></model-response>`;
}

/** Both bundled answer names have disappeared, while their content protocol is intact. */
export function renameGeminiAnswer(host: HTMLElement): HTMLElement {
  const message = host.querySelector('message-content')!;
  message.outerHTML = message.outerHTML.replaceAll('message-content', 'answer-content');
  const answer = host.querySelector<HTMLElement>('#answer')!;
  answer.className = 'answer-surface md-content';
  return answer;
}
