import type { PrimitiveContract } from '../contractTypes';

export const contract: PrimitiveContract = {
  name: 'conversationExport',
  sinceEngine: '1.10.0',
  semantic: ['userTurn', 'assistantTurn', 'scrollContainer'],
  params: {},
  description:
    'Export a conversation through the shared format dialog and message selection toolbar. Requires the site.json export descriptor and conversationIdPattern, except on a site whose reader Voyager ships (Gemini or ChatGPT). On Gemini only Voyager’s official export plugin may invoke it. The descriptor reads mounted or virtual turns into content snapshots and warns when completeness cannot be confirmed. Site selectors and reading policy belong to site.json. Disabling cancels the run and removes the entry points.',
};
