import { expect, it } from 'vitest';

import { isEmptySyncFileContent } from '../cloudSyncEmptyContent';

it.each([
  { name: 'gemini-voyager-folders.json', content: { folders: [], folderContents: {} } },
  { name: 'gemini-voyager-forks.json', content: { nodes: {}, groups: {} } },
  { name: 'gemini-voyager-starred.json', content: { messages: {} } },
])('unknown data alongside the empty $name projection remains pending', ({ name, content }) => {
  expect(isEmptySyncFileContent(name, content)).toBe(true);
  expect(
    isEmptySyncFileContent(name, { ...content, futureRecords: ['preserve unknown data'] }),
  ).toBe(false);
});
