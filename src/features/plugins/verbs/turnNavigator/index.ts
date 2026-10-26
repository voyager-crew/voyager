/**
 * `turnNavigator` primitive (D10): the conversation timeline rail. Every
 * parameter is optional; defaults come from the site adapter so a manifest
 * usually needs no more than `{ "op": "native", "handler": "turnNavigator" }`.
 */
import { withGuardedPageAdapter } from '@/core/selectors/semanticSnapshot';
import { logger } from '@/core/services/LoggerService';
import { isGeminiEnterpriseEnvironment } from '@/core/utils/gemini';
import { activateCatalogTimeline } from '@/features/timeline/adapters/catalog/activateCatalogTimeline';
import {
  TIMELINE_STYLE_COACHMARK_ID,
  type CatalogTimelineConfig,
} from '@/features/timeline/adapters/catalog/config';
import { siteConversationConfig } from '@/features/timeline/adapters/catalog/conversationId';
import { activateSharedGeminiTimeline } from '@/features/timeline/adapters/gemini/activateSharedGeminiTimeline';

import type { ManifestIssue } from '../../manifest/validate';
import { sendSiteOf } from '../../sends/trackUserSends';
import { isSafeRegexSource } from '../../sites/safeRegex';
import { SHARED_TIMELINE_IDENTITY_PARAMS } from '../../sites/sharedTimelinePolicy';
import { getPrimitiveContract } from '../contracts';
import type { Primitive } from '../types';

export interface TurnNavigatorParams {
  readonly dataBackend?: 'shared';
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
      dataBackend?: 'shared';
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
      if (key === 'dataBackend') {
        if (value === 'shared') params.dataBackend = value;
        else issues.push({ path: 'params.dataBackend', message: 'must be "shared"' });
        continue;
      }
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
    if (params.dataBackend === 'shared') {
      for (const key of SHARED_TIMELINE_IDENTITY_PARAMS) {
        if (Object.hasOwn(raw ?? {}, key))
          issues.push({
            path: `params.${key}`,
            message: 'shared data uses native conversation, account and turn identity',
          });
      }
    }
    return issues.length > 0 ? { success: false, error: issues } : { success: true, data: params };
  },

  activate(scope, params, context) {
    const adapter = withGuardedPageAdapter(context.adapter, context.doc);
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
    if (
      params.dataBackend === 'shared' &&
      (adapter.id !== 'gemini' ||
        location.hostname !== 'gemini.google.com' ||
        isGeminiEnterpriseEnvironment(location, context.doc) ||
        SHARED_TIMELINE_IDENTITY_PARAMS.some((key) => Object.hasOwn(params, key)))
    ) {
      logger.warn('turnNavigator: shared data requires the native Gemini consumer surface', {
        id: context.pluginId,
      });
      context.setTargetCounter(() => 0);
      return;
    }
    if (adapter.id === 'gemini' && params.dataBackend !== 'shared') {
      // Native identities and stars must never enter the catalog's Gemini-looking namespace.
      logger.warn('turnNavigator: Gemini requires the shared data backend', {
        id: context.pluginId,
      });
      context.setTargetCounter(() => 0);
      return;
    }
    context.setTargetCounter(() => {
      try {
        return context.doc.querySelectorAll(
          params.turn ?? adapter.selectors.userTurn ?? turnSelector,
        ).length;
      } catch {
        return 0;
      }
    });
    if (params.dataBackend === 'shared') {
      return activateSharedGeminiTimeline(
        scope,
        {
          position: params.position,
          scrollContainer: params.scrollContainer,
        },
        context.settings,
      );
    }
    const config: CatalogTimelineConfig = {
      ...siteConversationConfig(adapter, params.conversationIdPattern),
      siteLabel: adapter.label,
      get turnSelector() {
        return params.turn ?? adapter.selectors.userTurn ?? turnSelector;
      },
      get assistantTurnSelector() {
        return adapter.selectors.assistantTurn;
      },
      conversationIdAttribute: params.conversationIdAttribute,
      accountIdAttributes: params.accountIdAttributes,
      turnItemSelector: params.turnItem,
      get scrollContainerSelector() {
        return params.scrollContainer ?? adapter.selectors.scrollContainer;
      },
      get yieldWhenSelector() {
        return params.yieldWhen ?? adapter.selectors.sidePanel;
      },
      position: params.position ?? 'right',
      pluginId: context.pluginId,
      coachmarkId: TIMELINE_STYLE_COACHMARK_ID,
      sendSite: sendSiteOf(adapter),
    };
    return activateCatalogTimeline(scope, config, context.settings);
  },
};
