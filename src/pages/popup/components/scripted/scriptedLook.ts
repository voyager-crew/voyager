import { buttonVariants } from '../../../../components/ui/button';

/** Class names per part, so the popup and the panel share what scripted creations show. */
export interface ScriptedLook {
  readonly badge: string;
  readonly warning: string;
  readonly label: string;
  /** The full source: selectable, left to right. */
  readonly source: string;
  /**
   * When set, the source sits folded under its label in a `details` with this
   * class, and opens in the page flow; otherwise it shows open in its own box.
   */
  readonly disclosure?: string;
  readonly card: string;
  readonly title: string;
  readonly text: string;
  readonly steps: string;
  readonly address: string;
  readonly alert: string;
  readonly actions: string;
  readonly primary: string;
  readonly secondary: string;
}

export const POPUP_SCRIPTED_LOOK: ScriptedLook = {
  badge:
    'bg-warning/10 text-warning border-warning/40 ms-1.5 inline-block rounded border px-1.5 align-middle text-[10px] font-medium',
  warning: 'text-warning text-[11px] leading-snug font-medium',
  label: 'text-muted-foreground text-[11px]',
  source:
    'bg-background border-border/60 text-foreground mt-1 max-h-56 overflow-auto rounded border p-2 font-mono text-[10px] leading-snug whitespace-pre select-text',
  card: 'border-warning/40 bg-warning/5 space-y-1.5 rounded-md border p-2.5',
  title: 'text-xs font-medium',
  text: 'text-muted-foreground text-[11px] leading-snug',
  steps: 'list-decimal space-y-0.5 ps-4 text-[11px] leading-snug',
  address:
    'bg-background border-border/60 block rounded border p-1.5 font-mono text-[10px] break-all select-all',
  alert: 'text-destructive text-[11px] leading-snug',
  actions: 'flex flex-wrap justify-end gap-2',
  primary: buttonVariants({ size: 'sm' }),
  secondary: buttonVariants({ variant: 'outline', size: 'sm' }),
};
