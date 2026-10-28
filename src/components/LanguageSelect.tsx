import React, { useEffect, useId, useRef, useState } from 'react';

import { Check, ChevronDown, Globe } from 'lucide-react';

import { logger } from '@/core/services/LoggerService';

import { useLanguage } from '../contexts/LanguageContext';
import { APP_LANGUAGES, APP_LANGUAGE_LABELS, type AppLanguage } from '../utils/language';

/**
 * Pick the Voyager language from a list drawn in the page's own material
 * (the native select would open the OS menu). Writes the same setting as the
 * popup's toggle, so the choice carries into the popup, the in-page features
 * and plugins.
 */
export const LanguageSelect: React.FC<{ className?: string }> = ({ className }) => {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<AppLanguage>(language);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Partial<Record<AppLanguage, HTMLDivElement | null>>>({});
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[focused]?.focus();
  }, [open, focused]);

  const openList = () => {
    setFocused(language);
    setOpen(true);
  };

  const choose = (code: AppLanguage) => {
    void setLanguage(code).catch((error: unknown) => {
      logger.warn('Failed to select interface language', {
        language: code,
        error: String(error),
      });
    });
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Keys are handled on the focused option; focus always sits on one while open.
  const onListKeyDown = (event: React.KeyboardEvent) => {
    const index = APP_LANGUAGES.indexOf(focused);
    const move = (next: number) => {
      event.preventDefault();
      setFocused(APP_LANGUAGES[(next + APP_LANGUAGES.length) % APP_LANGUAGES.length]);
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(index + 1);
      case 'ArrowUp':
        return move(index - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(APP_LANGUAGES.length - 1);
      case 'Enter':
      case ' ':
        event.preventDefault();
        return choose(focused);
      case 'Escape':
      case 'Tab':
        setOpen(false);
        if (event.key === 'Escape') {
          event.preventDefault();
          triggerRef.current?.focus();
        }
        return;
      default:
        return;
    }
  };

  return (
    <div ref={rootRef} className={['relative', className ?? ''].join(' ')}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            openList();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className="hover:bg-accent text-foreground focus-visible:ring-ring inline-flex h-9 items-center gap-2 rounded-lg ps-2.5 pe-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
      >
        <Globe className="text-muted-foreground h-4 w-4" aria-hidden="true" />
        <span>{APP_LANGUAGE_LABELS[language]}</span>
        <ChevronDown
          className={[
            'text-muted-foreground h-4 w-4 transition-transform duration-200',
            open ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label="Language"
          aria-activedescendant={`${listId}-${focused}`}
          className="border-border/60 bg-card absolute end-0 z-50 mt-2 w-44 rounded-xl border p-1.5 shadow-xl"
        >
          {APP_LANGUAGES.map((code) => {
            const selected = code === language;
            return (
              <div
                key={code}
                id={`${listId}-${code}`}
                ref={(node) => {
                  optionRefs.current[code] = node;
                }}
                role="option"
                aria-selected={selected}
                tabIndex={code === focused ? 0 : -1}
                onClick={() => choose(code)}
                onKeyDown={onListKeyDown}
                onMouseEnter={() => setFocused(code)}
                lang={code.replace('_', '-')}
                className={[
                  'flex h-9 cursor-pointer items-center gap-2 rounded-lg ps-3 pe-2 text-sm outline-none select-none',
                  selected ? 'text-primary font-semibold' : 'text-foreground',
                  code === focused ? 'bg-accent' : '',
                ].join(' ')}
              >
                <span className="flex-1">{APP_LANGUAGE_LABELS[code]}</span>
                {selected && <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
