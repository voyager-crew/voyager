import { useRef, useState } from 'react';

import { ChevronDown, ClipboardPaste, Upload } from 'lucide-react';

import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import type { LocalPluginsController } from '../hooks/useLocalPlugins';

const REGION_ID = 'gv-local-plugin-more-ways';

/** Behind one disclosure: import plugin files a person or agent wrote, or paste a manifest. */
export function LocalPluginMoreWays({
  local,
  t,
}: {
  local: LocalPluginsController;
  t: (key: TranslationKey) => string;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={REGION_ID}
        onClick={() => setOpen((value) => !value)}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <span>{t('createModeMoreWays')}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={REGION_ID} className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={local.busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('localPluginsImportFiles')}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={local.busy}
              aria-expanded={pasteOpen}
              onClick={() => setPasteOpen((value) => !value)}
            >
              <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('localPluginsPasteJson')}</span>
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".json,.css,application/json,text/css"
            aria-label={t('localPluginsImportFiles')}
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length > 0) void local.importFiles(files);
            }}
          />
          {pasteOpen && (
            <div className="space-y-2">
              <textarea
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                aria-label={t('localPluginsPasteLabel')}
                spellCheck={false}
                rows={6}
                dir="ltr"
                placeholder='{ "id": "me.my-tweak", … }'
                className="bg-background border-border focus-visible:border-ring/70 focus-visible:ring-ring/30 w-full rounded-lg border p-2 font-mono text-[11px] transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:outline-none"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setPasteOpen(false)}>
                  {t('localPluginsCancel')}
                </Button>
                <Button
                  size="sm"
                  disabled={local.busy || pasteText.trim() === ''}
                  onClick={() => void local.importText(pasteText)}
                >
                  {t('localPluginsCheckAndImport')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
