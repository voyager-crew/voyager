import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { mapNoteProse } from '../noteSections';
import { formatShortcut, invalidShortcutSpecs, parseShortcut } from '../shortcutMarks';
import { unknownSwitchIds } from '../switchTargets';

function shown(spec: string, notation: 'mac' | 'other' | 'both'): string | null {
  const shortcut = parseShortcut(spec);
  return shortcut ? formatShortcut(shortcut, notation) : null;
}

describe('changelog shortcut markers', () => {
  it.each([
    ['Alt+V', '⌥V', 'Alt+V', 'Alt/⌥+V'],
    ['Mod+Shift+K', '⇧⌘K', 'Ctrl+Shift+K', 'Ctrl/⌘+Shift+K'],
    ['Mod+Enter', '⌘Enter', 'Ctrl+Enter', 'Ctrl/⌘+Enter'],
    ['Shift+Ctrl+up', '⌃⇧↑', 'Ctrl+Shift+↑', 'Ctrl+Shift+↑'],
    ['k', 'K', 'K', 'K'],
  ])('%s reads %s on macOS, %s elsewhere and %s on the built page', (spec, mac, other, both) => {
    expect(shown(spec, 'mac')).toBe(mac);
    expect(shown(spec, 'other')).toBe(other);
    expect(shown(spec, 'both')).toBe(both);
  });

  it.each(['Cmd+K', 'Alt+Alt+V', 'Mod+Ctrl+K', 'Alt+', 'V+Alt', 'Alt+Home'])(
    'rejects %s instead of guessing what it means',
    (spec) => {
      expect(parseShortcut(spec)).toBeNull();
    },
  );

  it('keeps markers inside inline code and fenced blocks as written', () => {
    const text = 'Press :kbd:Alt+V:, write `:kbd:Alt+V:`\n```\n:kbd:Alt+V:\n```';

    expect(mapNoteProse(text, (prose) => prose.replaceAll(':kbd:Alt+V:', 'X'))).toBe(
      'Press X, write `:kbd:Alt+V:`\n```\n:kbd:Alt+V:\n```',
    );
  });
});

describe('release notes', () => {
  const notesDir = join(__dirname, '..', 'notes');
  const files = readdirSync(notesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) =>
      readdirSync(join(notesDir, dir.name)).map((file) => join(notesDir, dir.name, file)),
    );

  // The viewer shows a bad marker as plain text; this is where a note with one fails.
  it.each(files)('%s uses only valid shortcut markers and listed switch targets', (file) => {
    const parts: string[] = [];
    mapNoteProse(readFileSync(file, 'utf8'), (text) => {
      parts.push(text);
      return text;
    });
    const prose = parts.join('\n');

    expect(invalidShortcutSpecs(prose)).toEqual([]);
    expect(unknownSwitchIds(prose)).toEqual([]);
  });

  it('catches an unlisted switch target and a malformed shortcut', () => {
    expect(unknownSwitchIds(':switch:voyager.gemini-folders: :switch:voyager.nope:')).toEqual([
      'voyager.gemini-folders',
      'voyager.nope',
    ]);
    expect(invalidShortcutSpecs(':kbd:Alt+V: :kbd:Hyper+V:')).toEqual(['Hyper+V']);
  });
});
