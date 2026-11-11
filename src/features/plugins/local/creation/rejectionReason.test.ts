import { describe, expect, it } from 'vitest';

import { rejectionReason } from './rejectionReason';
import { classifyReplyBlock } from './replyBlock';

const MANIFEST = {
  id: 'me.rounded',
  name: 'Rounded',
  version: '1.0.0',
  description: 'Round my messages',
  author: 'me',
  category: 'readability',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://claude.ai/*'],
  contributes: { styles: [{ css: '.gv-plugin-rounded{border-radius:16px}' }] },
};

function reasonFor(manifest: Record<string, unknown>): string {
  const verdict = classifyReplyBlock(JSON.stringify(manifest), {});
  if (verdict.kind !== 'rejected') throw new Error(`fixture must be refused, got ${verdict.kind}`);
  return rejectionReason(verdict.issues);
}

describe('the plain reason under a block Voyager cannot install', () => {
  it.each([
    [
      'a format of the AI’s own',
      { name: 'Wide chat', version: '1.0', target: 'gemini', css: '.a{}' },
      'createModeReasonNotPlugin',
    ],
    ['no site', { ...MANIFEST, matches: undefined }, 'createModeReasonNoSite'],
    [
      'a site Voyager does not support',
      { ...MANIFEST, matches: ['https://example.com/*'] },
      'createModeReasonBadSite',
    ],
    ['nothing to change', { ...MANIFEST, contributes: undefined }, 'createModeReasonNoChange'],
    [
      'CSS that loads something',
      { ...MANIFEST, contributes: { styles: [{ css: '@import url(x.css);' }] } },
      'createModeReasonBadChange',
    ],
    ['a missing author', { ...MANIFEST, author: undefined }, 'createModeReasonOther'],
  ])('names %s', (_label, manifest, reason) => {
    expect(reasonFor(manifest)).toBe(reason);
  });
});
