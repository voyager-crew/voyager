import { describe, expect, it } from 'vitest';

import {
  MAX_CREATION_FIX_CHARS,
  MAX_CREATION_FIX_LINE_CHARS,
  buildCreationFixMessage,
} from './fixMessage';

const INTRO = 'Voyager could not install that plugin. Fix these problems:';

describe('the message that sends gate problems back to the AI', () => {
  it('lists each issue as path: message under the intro', () => {
    const message = buildCreationFixMessage(
      [
        { path: 'name', message: 'required' },
        { path: '', message: 'manifest must be a JSON object' },
      ],
      INTRO,
    );
    expect(message).toBe(`${INTRO}\nname: required\nmanifest must be a JSON object`);
  });

  it('stays within its ceiling and counts the issues it leaves out', () => {
    const issues = Array.from({ length: 200 }, (_, index) => ({
      path: `contributes.domOps[${index}].target`,
      message: 'targets a semantic key the site does not declare',
    }));
    const message = buildCreationFixMessage(issues, INTRO);
    const lines = message.split('\n');
    const listed = lines.length - 2;
    expect(message.length).toBeLessThanOrEqual(MAX_CREATION_FIX_CHARS);
    expect(lines[0]).toBe(INTRO);
    expect(lines[1]).toBe(
      'contributes.domOps[0].target: targets a semantic key the site does not declare',
    );
    expect(lines.at(-1)).toBe(`… (+${issues.length - listed})`);
  });

  it('shortens one oversized issue instead of dropping the rest', () => {
    const message = buildCreationFixMessage(
      [
        { path: 'matches[0]', message: 'x'.repeat(10_000) },
        { path: 'name', message: 'required' },
      ],
      INTRO,
    );
    const [, first, second] = message.split('\n');
    expect(first.length).toBe(MAX_CREATION_FIX_LINE_CHARS);
    expect(first.endsWith('…')).toBe(true);
    expect(second).toBe('name: required');
  });
});
