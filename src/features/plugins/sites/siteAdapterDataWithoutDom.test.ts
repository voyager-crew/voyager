// @vitest-environment node
// The catalog build validates site.json under Bun, where there is no DOM to parse selectors.
import { expect, it } from 'vitest';

import { isValidSelectorSyntax } from './siteAdapterData';

it('catches unbalanced selectors with the structural fallback when there is no DOM', () => {
  expect(globalThis.document).toBeUndefined();
  expect(isValidSelectorSyntax('div[data-x="a]"]')).toBe(true);
  expect(isValidSelectorSyntax('div[data-x')).toBe(false);
  expect(isValidSelectorSyntax('a:not(.b')).toBe(false);
  expect(isValidSelectorSyntax("a[title='x]")).toBe(false);
});
