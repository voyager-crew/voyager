import { HighlightedCode } from './scripted/HighlightedCode';

const POPUP_CSS_CLASS =
  'bg-background border-border/60 text-foreground mt-1 max-h-40 overflow-auto rounded border p-2 font-mono text-[10px] leading-snug break-all whitespace-pre-wrap';

/** A plugin's stylesheets in full, scrollable and monospace: CSS is shown, never summarized. */
export function LocalPluginCssSource({
  css,
  label,
  className = POPUP_CSS_CLASS,
}: {
  css: readonly string[];
  label: string;
  className?: string;
}) {
  if (css.length === 0) return null;
  return (
    <pre aria-label={label} data-testid="local-plugin-css" dir="ltr" className={className}>
      <HighlightedCode source={css.join('\n\n')} language="css" />
    </pre>
  );
}
