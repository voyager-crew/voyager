import { type ReactNode, useMemo } from 'react';

import { inspectPlugin } from '@/features/plugins/local/inspectPlugin';
import { isScriptedManifest } from '@/features/plugins/scripted/types';
import type { PluginManifest } from '@/features/plugins/types';
import type { TranslationKey } from '@/utils/translations';

import { LocalPluginCssSource } from './LocalPluginCssSource';
import { ScriptedSource } from './scripted/ScriptedSource';
import { POPUP_SCRIPTED_LOOK } from './scripted/scriptedLook';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-foreground text-[11px] font-medium">{label}</dt>
      <dd className="text-muted-foreground mt-0.5 text-[11px] leading-snug break-words">
        {children}
      </dd>
    </div>
  );
}

function Lines({ items, none }: { items: readonly string[]; none: string }) {
  if (items.length === 0) return <>{none}</>;
  return (
    <ul className="space-y-0.5">
      {items.map((item, index) => (
        <li key={index} className="font-mono text-[10px] break-all">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * Inspect-before-enable view of a validated plugin: where it runs, its CSS in
 * full, each page change, every Voyager built-in it calls with its
 * params, and its settings. A plugin that runs code shows where it runs, the
 * warning and its full source.
 */
export function LocalPluginInspection({
  manifest,
  t,
}: {
  manifest: PluginManifest;
  t: (key: TranslationKey) => string;
}) {
  const inspection = useMemo(() => inspectPlugin(manifest), [manifest]);
  const none = t('localPluginInspectNone');
  if (isScriptedManifest(manifest)) {
    return (
      <div
        className="border-border/60 bg-muted/30 mt-2 space-y-2 rounded-md border p-2.5"
        data-testid="local-plugin-inspection"
      >
        <p className="text-muted-foreground text-[11px] leading-snug break-all">
          {`${inspection.id} · v${inspection.version} · ${inspection.author}`}
        </p>
        <ScriptedSource
          source={manifest.contributes.script.source}
          sites={[...new Set(inspection.sites.map(({ pattern, site }) => site ?? pattern))]}
          look={POPUP_SCRIPTED_LOOK}
          t={t}
        />
      </div>
    );
  }
  return (
    <div
      className="border-border/60 bg-muted/30 mt-2 space-y-2 rounded-md border p-2.5"
      data-testid="local-plugin-inspection"
    >
      <p className="text-muted-foreground text-[11px] leading-snug break-all">
        {`${inspection.id} · v${inspection.version} · ${inspection.author}`}
      </p>
      <dl className="space-y-2">
        <Row label={t('localPluginInspectSites')}>
          <Lines
            items={inspection.sites.map(({ pattern, site }) =>
              site ? `${site}: ${pattern}` : pattern,
            )}
            none={none}
          />
        </Row>
        <Row label={t('localPluginInspectCss')}>
          {inspection.styleSheets === 0 ? (
            none
          ) : (
            <>
              {t('localPluginInspectCssChars').replace('{chars}', String(inspection.cssChars))}
              <LocalPluginCssSource css={inspection.css} label={t('localPluginInspectCss')} />
            </>
          )}
        </Row>
        <Row label={t('localPluginInspectDomOps')}>
          <Lines items={inspection.domOps} none={none} />
        </Row>
        <Row label={t('localPluginInspectPrimitives')}>
          <Lines
            items={inspection.primitives.map(({ handler, params }) => `${handler} ${params}`)}
            none={none}
          />
        </Row>
        <Row label={t('localPluginInspectSettings')}>
          <Lines
            items={inspection.settings.map(
              ({ key, type, label, defaultValue }) =>
                `${key} (${type}) “${label}” = ${defaultValue}`,
            )}
            none={none}
          />
        </Row>
      </dl>
      <p className="text-muted-foreground text-[11px] leading-snug">
        {t('localPluginInspectNoCode')}
      </p>
    </div>
  );
}
