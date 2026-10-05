/**
 * `turnNavigator` primitive (plan §6): the conversation timeline rail. Every
 * parameter is optional; defaults come from the site adapter so a manifest
 * usually needs no more than `{ "op": "native", "handler": "turnNavigator" }`.
 */
import { logger } from '@/core/services/LoggerService';
import { activateCatalogTimeline } from '@/features/timeline/adapters/catalog/activateCatalogTimeline';
import {
  TIMELINE_STYLE_COACHMARK_ID,
  type CatalogTimelineConfig,
} from '@/features/timeline/adapters/catalog/config';
import { siteConversationConfig } from '@/features/timeline/adapters/catalog/conversationId';

import type { ManifestIssue } from '../manifest/validate';
import { isSafeRegexSource } from '../sites/safeRegex';
import { getPrimitiveContract } from './contracts';
import type { Primitive } from './types';

export interface TurnNavigatorParams {
  readonly turn?: string;
  readonly conversationIdAttribute?: string;
  readonly accountIdAttributes?: readonly string[];
  readonly turnItem?: string;
  readonly conversationIdPattern?: string;
  readonly scrollContainer?: string;
  readonly yieldWhen?: string;
  readonly position?: 'left' | 'right';
}

const MAX_SELECTOR_LENGTH = 2_000;
/** A plain lower-case attribute name: it is interpolated into `[name]`. */
const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const SELECTOR_PARAMS = ['turn', 'turnItem', 'scrollContainer', 'yieldWhen'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSelector(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_SELECTOR_LENGTH
  );
}

export const turnNavigatorPrimitive: Primitive<TurnNavigatorParams> = {
  contract: getPrimitiveContract('turnNavigator')!,

  validateParams(raw: unknown) {
    if (raw !== undefined && !isRecord(raw)) {
      return { success: false, error: [{ path: 'params', message: 'must be an object' }] };
    }
    const issues: ManifestIssue[] = [];
    const params: {
      turn?: string;
      conversationIdAttribute?: string;
      accountIdAttributes?: string[];
      turnItem?: string;
      conversationIdPattern?: string;
      scrollContainer?: string;
      yieldWhen?: string;
      position?: 'left' | 'right';
    } = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      if ((SELECTOR_PARAMS as readonly string[]).includes(key)) {
        if (!isSelector(value)) {
          issues.push({ path: `params.${key}`, message: 'must be a non-empty selector' });
        } else {
          params[key as (typeof SELECTOR_PARAMS)[number]] = value;
        }
        continue;
      }
      if (key === 'conversationIdPattern') {
        if (!isSelector(value)) {
          issues.push({
            path: 'params.conversationIdPattern',
            message: 'must be a non-empty string',
          });
          continue;
        }
        if (isSafeRegexSource(value)) {
          params.conversationIdPattern = value;
        } else {
          issues.push({
            path: 'params.conversationIdPattern',
            message:
              'must be a valid regular expression without lookarounds, backreferences or nested quantifiers',
          });
        }
        continue;
      }
      if (key === 'conversationIdAttribute') {
        if (typeof value === 'string' && ATTRIBUTE_NAME.test(value)) params[key] = value;
        else issues.push({ path: `params.${key}`, message: 'must be a lower-case attribute name' });
        continue;
      }
      if (key === 'accountIdAttributes') {
        if (
          Array.isArray(value) &&
          value.every(
            (attribute) => typeof attribute === 'string' && ATTRIBUTE_NAME.test(attribute),
          )
        )
          params.accountIdAttributes = value;
        else
          issues.push({
            path: `params.${key}`,
            message: 'must be an array of lower-case attribute names',
          });
        continue;
      }
      if (key === 'position') {
        if (value === 'left' || value === 'right') params.position = value;
        else issues.push({ path: 'params.position', message: 'must be "left" or "right"' });
        continue;
      }
      issues.push({ path: `params.${key}`, message: 'unknown parameter' });
    }
    return issues.length > 0 ? { success: false, error: issues } : { success: true, data: params };
  },

  activate(scope, params, context) {
    const adapter = context.adapter;
    if (!adapter) {
      // Stars, outlines and placement are keyed by the site id; without one, every such
      // site would share a single namespace, so stay inert instead.
      logger.warn('turnNavigator: no site adapter for this page', { id: context.pluginId });
      context.setTargetCounter(() => 0);
      return;
    }
    const turnSelector = params.turn ?? adapter.selectors.userTurn;
    if (!turnSelector) {
      // The status machine reports needs-semantic before this can happen;
      // stay inert rather than index nothing.
      logger.warn('turnNavigator: no turn selector for this site', { id: context.pluginId });
      context.setTargetCounter(() => 0);
      return;
    }
    context.setTargetCounter(() => {
      try {
        return context.doc.querySelectorAll(turnSelector).length;
      } catch {
        return 0;
      }
    });
    const config: CatalogTimelineConfig = {
      ...siteConversationConfig(adapter, params.conversationIdPattern),
      siteLabel: adapter.label,
      turnSelector,
      assistantTurnSelector: adapter.selectors.assistantTurn,
      conversationIdAttribute: params.conversationIdAttribute,
      accountIdAttributes: params.accountIdAttributes,
      turnItemSelector: params.turnItem,
      scrollContainerSelector: params.scrollContainer ?? adapter.selectors.scrollContainer,
      yieldWhenSelector: params.yieldWhen,
      position: params.position ?? 'right',
      pluginId: context.pluginId,
      coachmarkId: TIMELINE_STYLE_COACHMARK_ID,
    };
    return activateCatalogTimeline(scope, config, context.settings);
  },
};
