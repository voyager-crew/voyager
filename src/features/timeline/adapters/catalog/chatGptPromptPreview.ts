const AMBIENT_BROWSER_CONTEXT =
  /<in-app-browser-context\b(?=[^>]*\bsource\s*=\s*(?:"ambient-ui-state"|'ambient-ui-state'))[^>]*>[\s\S]*?<\/in-app-browser-context\s*>/gi;
const SELECTION_WRAPPER = /^#[ \t]+Selected text:[ \t]*\r?\n\s*##[ \t]+Selection[ \t]+\d+\b/i;
const REQUEST_HEADING = /^##[ \t]+My request:[ \t]*/im;

/** Match ChatGPT's displayed prompt while keeping ordinary Markdown headings. */
export function chatGptPromptPreview(raw: string): string {
  const withoutContext = raw.replace(AMBIENT_BROWSER_CONTEXT, ' ');
  const prompt = withoutContext.trimStart();
  const selectedText = SELECTION_WRAPPER.test(prompt);
  const heading = REQUEST_HEADING.exec(prompt);
  // A leading request heading alone can also be text the user typed.
  if (!heading || (!selectedText && (withoutContext === raw || heading.index !== 0))) return prompt;
  return prompt.slice(heading.index + heading[0].length);
}
