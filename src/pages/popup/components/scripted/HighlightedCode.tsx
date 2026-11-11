import { useMemo } from 'react';

import { type CodeLanguage, tokenizeCode } from '@/features/plugins/local/codeTokens';

/**
 * Source text with its syntax coloured, for the inside of a `<pre>`. Each
 * token is a text node or a span holding exactly its slice of the source, so
 * the element's text is the source itself. Colours come from `--code-*`
 * (`.tok-*` rules in the panel's and the popup's styles).
 */
export function HighlightedCode({ source, language }: { source: string; language: CodeLanguage }) {
  const tokens = useMemo(() => tokenizeCode(source, language), [source, language]);
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === 'plain' ? (
          token.text
        ) : (
          <span key={index} className={`tok-${token.kind}`}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}
