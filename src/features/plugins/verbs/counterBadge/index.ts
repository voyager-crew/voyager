/**
 * `counterBadge` primitive: a small read-only badge with a live count of the
 * composer draft (`target: "composer"`) or of each assistant reply
 * (`target: "assistantTurn"`). See `count.ts` for the metrics and `badge.ts`
 * for why the label never reaches copied or exported text.
 */
import { hasPageSemanticFixes } from '@/core/selectors/semanticSnapshot';

import type { ManifestIssue } from '../../manifest/validate';
import { getPrimitiveContract } from '../contracts';
import type { Primitive } from '../types';
import { COUNTER_BADGE_CSS } from './badge';
import { startComposerBadge } from './composerBadge';
import { COUNTER_METRICS, type CounterMetric, isCounterMetric } from './count';
import { startTurnBadges } from './turnBadges';

export type CounterTarget = 'composer' | 'assistantTurn';

export interface CounterBadgeParams {
  readonly target: CounterTarget;
  readonly metric: CounterMetric;
}

const TARGETS: readonly string[] = ['composer', 'assistantTurn'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCounterTarget(value: unknown): value is CounterTarget {
  return typeof value === 'string' && TARGETS.includes(value);
}

export const counterBadgePrimitive: Primitive<CounterBadgeParams> = {
  contract: getPrimitiveContract('counterBadge')!,

  validateParams(raw: unknown) {
    if (raw !== undefined && !isRecord(raw)) {
      return { success: false, error: [{ path: 'params', message: 'must be an object' }] };
    }
    const issues: ManifestIssue[] = [];
    const { target, metric, ...unknown } = raw ?? {};
    for (const key of Object.keys(unknown)) {
      issues.push({ path: `params.${key}`, message: 'unknown parameter' });
    }
    if (!isCounterTarget(target)) {
      issues.push({ path: 'params.target', message: `must be one of ${TARGETS.join(', ')}` });
    }
    if (metric !== undefined && !isCounterMetric(metric)) {
      issues.push({
        path: 'params.metric',
        message: `must be one of ${COUNTER_METRICS.join(', ')}`,
      });
    }
    return issues.length > 0 || !isCounterTarget(target)
      ? { success: false, error: issues }
      : { success: true, data: { target, metric: isCounterMetric(metric) ? metric : 'chars' } };
  },

  activate(scope, params, context) {
    const { doc, adapter } = context;
    const selector = adapter?.selectors[params.target];
    if (!selector) return;
    const checked = hasPageSemanticFixes(
      adapter,
      params.target === 'composer' ? ['composer', 'composerRoot', 'sendButton'] : ['assistantTurn'],
      doc,
    );
    const readSelector = () => (checked ? adapter!.selectors[params.target] : selector);
    context.setTargetCounter(() => doc.querySelectorAll(readSelector()).length);

    // One effect owns styles, observers and badges, so unmount removes them together.
    scope.effect(() => {
      const style = doc.createElement('style');
      style.setAttribute('data-gv-plugin-scope', '');
      style.textContent = COUNTER_BADGE_CSS;
      doc.head.append(style);
      let stop: () => void;
      try {
        stop =
          params.target === 'composer'
            ? startComposerBadge({
                doc,
                composer: selector,
                composerRoot: adapter?.selectors.composerRoot,
                metric: params.metric,
                ...(checked
                  ? {
                      resolveSelectors: () => ({
                        composer: adapter!.selectors.composer,
                        composerRoot: adapter!.selectors.composerRoot,
                      }),
                    }
                  : {}),
              })
            : startTurnBadges({
                doc,
                turn: selector,
                metric: params.metric,
                ...(checked ? { resolveTurn: readSelector } : {}),
              });
      } catch (error) {
        style.remove();
        throw error;
      }
      return () => {
        stop();
        style.remove();
      };
    }, 'counter-badge');
    // Static params need no restart; templated params restart through the engine.
    return { updateSettings() {} };
  },
};
