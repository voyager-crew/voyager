import type { PrimitiveContract } from '../contractTypes';

export const contract: PrimitiveContract = {
  name: 'turnNavigator',
  sinceEngine: '1.4.0',
  semantic: ['userTurn'],
  params: {
    dataBackend: {
      type: 'string',
      required: false,
      sinceEngine: '1.9.0',
      description:
        '"shared" uses Voyager’s native stars and hierarchy on consumer gemini.google.com only. Required on Gemini; omit on catalog sites. Shared mode rejects turn, turnItem, conversationIdPattern, conversationIdAttribute and accountIdAttributes overrides; native route, account and canonical turn identity remain authoritative.',
    },
    turn: {
      type: 'selector',
      required: false,
      description: "User-turn elements to index; defaults to the site adapter's userTurn.",
    },
    conversationIdAttribute: {
      type: 'string',
      required: false,
      sinceEngine: '1.5.0',
      description:
        'Attribute holding the conversation id that conversationIdPattern captures from the URL, on an ancestor of each turn or inside its turnItem. When set, it is the only thing that lets a turn be starred: the id must name the current conversation; a turn without one stays unstarrable.',
    },
    accountIdAttributes: {
      type: 'string[]',
      required: false,
      sinceEngine: '1.5.0',
      description:
        'Ordered attributes on document.documentElement identifying the loaded account. Stars hash their values together; missing values leave the star untagged.',
    },
    turnItem: {
      type: 'selector',
      required: false,
      sinceEngine: '1.5.0',
      description:
        'Element wrapping one exchange (prompt and reply). conversationIdAttribute is looked up inside it when no ancestor of the turn carries it.',
    },
    reply: {
      type: 'selector',
      required: false,
      sinceEngine: '2.3.2',
      description:
        'Elements holding one assistant reply each. A reply that follows another reply with no user turn between them, such as a scheduled task’s later runs, gets its own marker labelled with its text. Omit it and only user turns are marked.',
    },
    conversationIdPattern: {
      type: 'string',
      required: false,
      description:
        "Path regular expression whose first group is the conversation id; defaults to the site adapter's conversationIdPattern.",
    },
    scrollContainer: {
      type: 'selector',
      required: false,
      description:
        "Element that scrolls the conversation; defaults to the site adapter's scrollContainer, else auto-detected.",
    },
    yieldWhen: {
      type: 'selector',
      required: false,
      description:
        'While this matches (an open side panel, an artifact frame), the onboarding guide stays closed.',
    },
    position: {
      type: 'string',
      required: false,
      description: 'Rail side: "right" (default) or "left".',
    },
  },
  description:
    'A compact conversation timeline with starred messages and search, built on the same code as the Claude timeline.',
};
