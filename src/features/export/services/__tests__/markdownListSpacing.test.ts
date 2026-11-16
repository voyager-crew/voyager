import { describe, expect, it } from 'vitest';

import { separateMarkdownLists } from '../markdownListSpacing';

describe('separateMarkdownLists', () => {
  it('leaves a list that already has a blank line, and a nested item', () => {
    const markdown = 'Intro\n\n- one\n- two\n  - nested\n';
    expect(separateMarkdownLists(markdown)).toBe(markdown);
  });

  it('does not open a blank line inside a fence, including a tilde fence', () => {
    const markdown = 'Before\n~~~\nkeep\n- sample\n~~~\nAfter\n1. real';
    expect(separateMarkdownLists(markdown)).toBe(
      'Before\n~~~\nkeep\n- sample\n~~~\nAfter\n\n1. real',
    );
  });

  it('does not treat an indented list as a new top-level list', () => {
    expect(separateMarkdownLists('- parent\n  continuation\n  - child')).toBe(
      '- parent\n  continuation\n  - child',
    );
  });
});
