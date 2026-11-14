/** @jsxImportSource preact */
import type { CSSProperties } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { isImeKeyEvent } from '@/core/services/composer/sendKeys/sendKeyIntent';

import { eventPassedThrough } from '../shadowHost';
import { KEEPS_INLINE_FORM_ATTR, MAX_FOLDER_NAME_LENGTH, MENU_SELECTOR, cls, t } from './shared';
import { CHECK, type IconNode, LineIcon, X } from './treeIcons';

type IconButtonProps = {
  modifier: string;
  labelKey: string;
  text: string;
  /** Drawn in place of `text` (a `lineIcons` tree). */
  icon?: IconNode;
  active?: boolean;
  /** Fills the line icon without the active look, as a pinned folder's pin. Default: `active`. */
  filled?: boolean;
  onClick: (e: MouseEvent) => void;
};

export function IconButton({
  modifier,
  labelKey,
  text,
  icon,
  active,
  filled = active,
  onClick,
}: IconButtonProps) {
  const label = t(labelKey);
  const classes = [cls('icon-button'), cls(`icon-button--${modifier}`)];
  if (active) classes.push(cls('icon-button--active'));
  return (
    <button
      type="button"
      class={classes.join(' ')}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {/* An active line icon is filled, as a starred conversation's star. */}
      {icon ? <LineIcon node={icon} filled={filled} /> : text}
    </button>
  );
}

type InlineFormProps = {
  initialValue: string;
  /** Save and cancel as line icons. */
  lineIcons?: boolean;
  extraClass?: string;
  style?: CSSProperties;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

const KEEPS_FORM_SELECTOR = `${MENU_SELECTOR}, [${KEEPS_INLINE_FORM_ATTR}]`;

// The panel lives in a shadow root, where a document listener sees the host as
// the target; the composed path still names the real element.
function keepsFormOpen(e: Event): boolean {
  return e
    .composedPath()
    .some((node) => node instanceof Element && node.matches(KEEPS_FORM_SELECTOR));
}

/**
 * Name editor for create and rename. A mousedown anywhere outside it (except the
 * context menu and controls marked with KEEPS_INLINE_FORM_ATTR) cancels. The listener lives exactly as long as the form is
 * mounted, so re-rendering the tree around it keeps it working.
 */
export function InlineForm({
  initialValue,
  lineIcons,
  extraClass,
  style,
  onSubmit,
  onCancel,
}: InlineFormProps) {
  const formRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => onSubmit(inputRef.current?.value.trim() ?? '');

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const focusInput = () => {
      input.focus();
      input.select();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focusInput);
    } else {
      focusInput();
    }
  }, []);

  // Re-registered when the handler changes, and removed on unmount.
  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onOutsideMouseDown = (e: MouseEvent) => {
      if (eventPassedThrough(e, form) || keepsFormOpen(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }, [onCancel]);

  const classes = extraClass ? `${cls('inline-form')} ${extraClass}` : cls('inline-form');
  return (
    <div ref={formRef} class={classes} style={style}>
      <input
        ref={inputRef}
        type="text"
        class={cls('inline-input')}
        // Uncontrolled: the initial name seeds it, and re-renders leave the draft alone.
        defaultValue={initialValue}
        placeholder={t('floatingPanelFolderNamePlaceholder')}
        maxLength={MAX_FOLDER_NAME_LENGTH}
        onClick={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Enter or Escape while an IME composes picks or drops a candidate, not the name.
          if (isImeKeyEvent(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <IconButton
        modifier="save"
        labelKey="floatingPanelSave"
        text="✓"
        icon={lineIcons ? CHECK : undefined}
        onClick={(e) => {
          e.stopPropagation();
          submit();
        }}
      />
      <IconButton
        modifier="cancel"
        labelKey="floatingPanelCancel"
        text="×"
        icon={lineIcons ? X : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
      />
    </div>
  );
}
