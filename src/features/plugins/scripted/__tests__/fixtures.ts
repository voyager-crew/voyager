export const SCRIPTED_ID = 'local.me.send-counter';

export function declarative(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'me.wide-chat',
    name: 'Wide chat',
    version: '1.0.0',
    description: 'Widen the chat column',
    author: 'Me',
    category: 'layout',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: ['https://chatgpt.com/*'],
    contributes: { styles: [{ css: '.gv-wide{max-width:none}' }] },
    ...overrides,
  };
}

export function scripted(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...declarative({
      id: 'me.send-counter',
      name: 'Send counter',
      description: 'Counts my sends',
      category: 'productivity',
      tier: 'scripted',
      contributes: { script: { source: 'document.title = "sent: 0";' } },
    }),
    ...overrides,
  };
}

/** A scripted manifest as the store keeps it: id already namespaced. */
export function storedScripted(source = 'document.title = "sent: 0";', extra = {}) {
  return { ...scripted({ contributes: { script: { source } }, ...extra }), id: SCRIPTED_ID };
}
