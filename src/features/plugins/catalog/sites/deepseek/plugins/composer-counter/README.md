# DeepSeek · Draft counter

Shows a small live count of your draft just above the DeepSeek message box, at
its inline-end corner. Choose what it counts in Voyager's popup:

| Setting value     | Counts                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `chars` (default) | Unicode code points, line breaks excluded (an emoji such as 😀 counts once; a ZWJ sequence such as 👨‍👩‍👧 counts each joined code point) |
| `words`           | whitespace-separated words, with each Chinese, Japanese or Korean character counted as one word; punctuation alone is not a word     |
| `cjkChars`        | Han, Hiragana, Katakana and Hangul characters only                                                                                   |
| `lines`           | lines of the draft; an empty draft is 0, and a trailing line break opens a line                                                      |

There is no token count: Voyager ships no tokenizer.

The plugin invokes Voyager's `counterBadge` primitive with
`{ "target": "composer", "metric": "{{metric}}" }`. The primitive reads the
draft with Voyager's composer reader, which follows the editor's paragraph
structure instead of `innerText`, and updates once per animation frame while
you type. DeepSeek's composer is a `textarea`: when the site clears it after a
send without an input event, the badge catches up once the page settles
(about a quarter second after the new message appears). The badge moves to the
new composer after in-app navigation without leaving a second badge.

The badge is hidden while the draft is empty. It is read-only and
pointer-transparent. Its label is CSS generated
content, so it never appears in copied text, exports or the draft. It is hidden
from screen readers because it changes on every keystroke. Turning the plugin
off removes the badge and its styles.

This requires an extension update that ships `counterBadge`. The manifest uses
`engine: ">=1.8.0"`; a catalog update alone cannot provide the primitive.

## Live check

Chrome, dark theme, the new-chat page, nothing sent: the badge stays hidden on
the empty composer and shows `字符数：12` for `你好 😀` plus `line two` just above
the composer card's top-right corner, mirroring the Vim plugin's mode label.
DeepSeek's composer root sits inside a card that clips its overflow, so the
badge attaches to the card's parent instead. Clearing the draft hides it again,
selecting the whole page copies no badge text, and turning the plugin off
leaves no badge, anchor class or style behind. The count after a real send was
not checked live.
