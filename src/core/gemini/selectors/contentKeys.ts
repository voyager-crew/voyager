/** Each content surface validates independently before any live DOM mutation. */
export const GEMINI_CONTENT_PROFILE_KEYS = ['content.answer', 'content.userLines'] as const;
export const GEMINI_CONTEXT_IMAGE_PROFILE_KEYS = ['context.images'] as const;
