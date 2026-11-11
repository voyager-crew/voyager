/**
 * Sites whose default chat AI cannot open a link. Gemini's default model
 * (Flash), sent the short creation message, invented a plugin format and then
 * said it can only generate text, while ChatGPT and DeepSeek read the page. On
 * these sites the creation message carries the site's create page itself
 * (`creationMessage.ts`), still naming its URL, which marks the Create chat.
 */
const INLINE_CREATE_PAGE_SITES: ReadonlySet<string> = new Set(['gemini']);

/** True when the creation message for `siteId` carries its create page instead of a link. */
export function inlinesCreatePage(siteId: string): boolean {
  return INLINE_CREATE_PAGE_SITES.has(siteId);
}
