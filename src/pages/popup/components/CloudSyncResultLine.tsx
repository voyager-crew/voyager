import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';

const TONE_CLASS = {
  ok: 'text-success',
  warn: 'text-warning',
  err: 'text-destructive',
} as const;

export interface CloudSyncResultLineProps {
  readonly kind: keyof typeof TONE_CLASS;
  readonly text: string;
  readonly lines?: readonly string[];
  /** Present while the download that produced this result can be undone. */
  readonly undo?: { readonly busy: boolean; readonly run: () => void } | null;
  /** Default `center`, under the sync card's buttons; `start` in a card whose text is left-aligned. */
  readonly align?: 'center' | 'start';
  readonly t: (key: TranslationKey) => string;
}

/**
 * A sync result: its headline, then one line per reason, kept kind or warning,
 * then Undo for the download that just ran. It inherits the popup's direction.
 */
export function CloudSyncResultLine({
  kind,
  text,
  lines,
  undo,
  align = 'center',
  t,
}: CloudSyncResultLineProps) {
  return (
    <div
      role="status"
      className={`space-y-1 text-xs leading-snug ${align === 'center' ? 'text-center' : 'text-start'}`}
    >
      <p className={`font-medium ${TONE_CLASS[kind]}`}>{text}</p>
      {lines?.map((line) => (
        <p key={line} className="text-muted-foreground">
          {line}
        </p>
      ))}
      {undo && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-1 py-0.5 text-xs"
          disabled={undo.busy}
          onClick={undo.run}
        >
          {t(undo.busy ? 'syncUndoing' : 'syncUndo')}
        </Button>
      )}
    </div>
  );
}
