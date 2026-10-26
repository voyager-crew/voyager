import { decodeBatchExecute } from '@/core/utils/batchexecute';

import { GEMINI_USAGE_CONTENT, resolveGeminiUsageRoot } from './usageDom';
import type { RawMetric, UsageMetric, UsageSnapshot } from './usageSnapshot';

interface ParsedMetric {
  metric: RawMetric;
  period: number;
}

const KNOWN_TIERS = /\b(?:GOOGLE\s+AI\s+)?(?:FREE|PRO|ULTRA|ADVANCED|BUSINESS|ENTERPRISE)\b/i;

/** First `N% ...` percentage in a block of text, or null. */
function parsePercent(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

/**
 * Reset label for a metric block. Prefers the dedicated `reset-time` element
 * Gemini renders; strips a leading "Resets"/"Resets at" prefix (English UI)
 * while leaving other languages untouched so we still show *something*.
 */
function parseResetLabel(block: Element): string {
  const resetEl = block.querySelector(GEMINI_USAGE_CONTENT.reset);
  const raw = (resetEl?.textContent ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^resets?\b[\s:]*(?:at\b[\s:]*)?/i, '').trim() || raw;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLocalizedDigits(text: string, locale: string): string {
  let normalized = text.normalize('NFKC').replace(/\u00a0/g, ' ');
  try {
    const formatter = new Intl.NumberFormat(locale, { useGrouping: false });
    for (let digit = 0; digit <= 9; digit += 1) {
      const localized = formatter
        .formatToParts(digit)
        .find((part) => part.type === 'integer')?.value;
      if (localized && localized !== String(digit)) {
        normalized = normalized.replaceAll(localized, String(digit));
      }
    }
  } catch {
    // Invalid/unsupported locale — ASCII digits still cover Gemini's fallback UI.
  }
  return normalized.toLocaleLowerCase(locale).replace(/\s+/g, ' ').trim();
}

function localizedDayPeriod(locale: string, hour: number): string {
  try {
    return (
      new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true })
        .formatToParts(new Date(2024, 0, 1, hour))
        .find((part) => part.type === 'dayPeriod')?.value ?? ''
    );
  } catch {
    return '';
  }
}

function parseLocalizedMonthDay(
  text: string,
  locale: string,
): { month: number; day: number } | null {
  for (const monthStyle of ['long', 'short', 'numeric'] as const) {
    for (let month = 0; month < 12; month += 1) {
      try {
        const parts = new Intl.DateTimeFormat(locale, {
          month: monthStyle,
          day: 'numeric',
        }).formatToParts(new Date(2024, month, 23, 12));
        if (!parts.some((part) => part.type === 'month')) continue;
        const pattern = parts
          .map((part) => {
            if (part.type === 'day') return '(\\d{1,2})';
            const value = normalizeLocalizedDigits(part.value, locale);
            if (part.type === 'literal' && !value) return '\\s*';
            return `${escapeRegex(value).replace(/\s+/g, '\\s*')}\\s*`;
          })
          .join('');
        const match = text.match(new RegExp(pattern, 'iu'));
        if (!match) continue;
        const day = Number(match[1]);
        if (day >= 1 && day <= 31) return { month, day };
      } catch {
        // Try the next representation; Intl can reject an unexpected locale.
      }
    }
  }
  return null;
}

/** Convert Gemini's localized reset text into a local epoch for the countdown. */
export function parseResetEpoch(
  text: string,
  now: number,
  locale: string = 'en',
): number | undefined {
  const normalized = normalizeLocalizedDigits(text, locale || 'en');
  const timeMatch = normalized.match(/(\d{1,2})\s*[:：.]\s*(\d{2})/u);
  if (!timeMatch) return undefined;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return undefined;

  const amTokens = [localizedDayPeriod(locale, 1), 'am', 'a.m.', '上午', '凌晨'];
  const pmTokens = [localizedDayPeriod(locale, 13), 'pm', 'p.m.', '下午', '晚上', '中午'];
  const hasToken = (tokens: string[]): boolean =>
    tokens.some((token) => token && normalized.includes(normalizeLocalizedDigits(token, locale)));
  if (hasToken(pmTokens) && hour < 12) hour += 12;
  else if (hasToken(amTokens) && hour === 12) hour = 0;

  const nowDate = new Date(now);
  const monthDay = [...new Set([locale || 'en', 'en', 'zh-CN', 'zh-TW'])]
    .map((candidateLocale) => parseLocalizedMonthDay(normalized, candidateLocale))
    .find((value) => value !== null);
  const candidate = monthDay
    ? new Date(nowDate.getFullYear(), monthDay.month, monthDay.day, hour, minute)
    : new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), hour, minute);

  if (monthDay) {
    // The UI omits the year. A January date shown in December belongs to next year.
    if (candidate.getTime() < now - 180 * 24 * 60 * 60_000) {
      candidate.setFullYear(candidate.getFullYear() + 1);
    }
  } else if (candidate.getTime() <= now) {
    // A time-only reset label denotes the next occurrence in the user's timezone.
    candidate.setDate(candidate.getDate() + 1);
  }

  return Math.floor(candidate.getTime() / 1000);
}

/** Upgrade older DOM-only caches so the countdown works before /usage is revisited. */
export function hydrateUsageResetEpochs(
  snapshot: UsageSnapshot,
  now: number,
  locales: Array<string | undefined>,
): UsageSnapshot {
  const candidates = [...new Set(locales.filter((locale): locale is string => !!locale))];
  const hydrate = (metric: UsageMetric | null): UsageMetric | null => {
    if (!metric || typeof metric.resetEpoch === 'number') return metric;
    for (const locale of candidates) {
      const resetEpoch = parseResetEpoch(metric.resetLabel, now, locale);
      if (typeof resetEpoch === 'number') return { ...metric, resetEpoch };
    }
    return metric;
  };
  const daily = hydrate(snapshot.daily);
  const weekly = hydrate(snapshot.weekly);
  return daily === snapshot.daily && weekly === snapshot.weekly
    ? snapshot
    : { ...snapshot, daily, weekly };
}

function parseMetric(block: Element | null, now: number): UsageMetric | null {
  if (!block) return null;
  const percent = parsePercent(block.textContent ?? '');
  if (percent === null) return null;
  const resetText = (block.querySelector(GEMINI_USAGE_CONTENT.reset)?.textContent ?? '').trim();
  const resetEpoch = parseResetEpoch(
    resetText,
    now,
    block.ownerDocument.documentElement.lang || 'en',
  );
  return {
    percent,
    resetLabel: parseResetLabel(block),
    ...(typeof resetEpoch === 'number' ? { resetEpoch } : {}),
  };
}

function parseTier(root: Element): string | undefined {
  // Tier badge ("PRO") renders near the header, before the body copy. Match a
  // known tier token in the header region to avoid grabbing stray words.
  const header = root.querySelector(GEMINI_USAGE_CONTENT.header) ?? root;
  const match = (header.textContent ?? '').match(KNOWN_TIERS);
  return match ? match[0].replace(/\s+/g, ' ').trim().toUpperCase() : undefined;
}

/**
 * Parse the rendered `/usage` page into a {@link UsageSnapshot}. Pure /
 * side-effect-free (DOM in, data out) so it can be unit-tested in isolation.
 * Returns null when the usage component isn't present or neither bucket parses
 * — callers treat null as "don't clobber the cache".
 */
export function scrapeUsageFromDocument(
  doc: Document = document,
  now: number = Date.now(),
): UsageSnapshot | null {
  const root = resolveGeminiUsageRoot(doc);
  if (!root) return null;

  const daily = parseMetric(root.querySelector(GEMINI_USAGE_CONTENT.daily), now);
  const weekly = parseMetric(root.querySelector(GEMINI_USAGE_CONTENT.weekly), now);
  if (!daily && !weekly) return null;

  return { daily, weekly, tier: parseTier(root), updatedAt: now };
}

/** True for a `[limit, fraction, period, [[epoch, nanos]]]` metric tuple. */
function readMetric(m: unknown): ParsedMetric | null {
  if (!Array.isArray(m) || m.length < 4) return null;
  const fraction = m[1];
  const period = m[2];
  const resetWrap = m[3];
  if (typeof fraction !== 'number' || fraction < 0 || fraction > 1.5) return null;
  if (typeof period !== 'number') return null;
  if (!Array.isArray(resetWrap) || !Array.isArray(resetWrap[0])) return null;
  const epoch = resetWrap[0][0];
  if (typeof epoch !== 'number' || epoch < 1_600_000_000) return null;
  return { metric: { percent: Math.round(fraction * 100), resetEpoch: epoch }, period };
}

/** Pull {daily, weekly} out of a usage RPC payload, or null if it isn't one. */
export function extractUsagePayload(
  payload: unknown,
): { daily: RawMetric | null; weekly: RawMetric | null } | null {
  if (!Array.isArray(payload)) return null;
  // Gemini may append new quota buckets with a different tuple layout. Keep
  // parsing the known 5h/weekly metrics instead of rejecting the whole array
  // because one sibling bucket is unfamiliar.
  const metricsArr = payload.find(
    (x): x is unknown[] => Array.isArray(x) && x.some((m) => readMetric(m) !== null),
  );
  if (!metricsArr) return null;
  const metrics = metricsArr.map(readMetric).filter((m): m is ParsedMetric => m !== null);
  if (metrics.length === 0) return null;
  // Real captures show period 1 = rolling 5h window, period 2 = weekly limit.
  // Do not infer from reset time: the weekly boundary can arrive before 5h.
  const daily = metrics.find((m) => m.period === 1)?.metric ?? null;
  const weekly = metrics.find((m) => m.period === 2)?.metric ?? null;
  return daily || weekly ? { daily, weekly } : null;
}

/** Parse a raw batchexecute response into usage metrics + the carrying rpcid. */
export function parseUsageRpcResponse(
  text: string,
): { rpcid: string; daily: RawMetric | null; weekly: RawMetric | null } | null {
  for (const { rpcid, payload } of decodeBatchExecute(text)) {
    const usage = extractUsagePayload(payload);
    if (usage && (usage.daily || usage.weekly)) return { rpcid, ...usage };
  }
  return null;
}

/**
 * Format a reset epoch into a short label: time-only today, else date + time.
 * `locale` (a BCP-47 tag derived from the Voyager language) localizes it so a
 * zh user sees `6月16日 22:47` rather than the browser's system locale.
 */
export function formatResetLabel(epochSec: number, now: number, locale?: string): string {
  try {
    const d = new Date(epochSec * 1000);
    const n = new Date(now);
    const sameDay =
      d.getFullYear() === n.getFullYear() &&
      d.getMonth() === n.getMonth() &&
      d.getDate() === n.getDate();
    return sameDay
      ? d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleString(locale, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
  } catch {
    return '';
  }
}

function metricFromRaw(m: RawMetric | null, now: number, locale?: string): UsageMetric | null {
  return m
    ? {
        percent: m.percent,
        resetLabel: formatResetLabel(m.resetEpoch, now, locale),
        resetEpoch: m.resetEpoch,
      }
    : null;
}

/** Build a snapshot from parsed RPC metrics, carrying the tier forward. */
export function snapshotFromParsed(
  parsed: { daily: RawMetric | null; weekly: RawMetric | null },
  now: number,
  tier: string | undefined,
  accountKey: string,
  locale: string | undefined,
  sourceStartedAt: number = now,
  regressionVerified = false,
): UsageSnapshot {
  return {
    daily: metricFromRaw(parsed.daily, now, locale),
    weekly: metricFromRaw(parsed.weekly, now, locale),
    tier,
    accountKey,
    sourceStartedAt,
    regressionVerified,
    updatedAt: now,
  };
}
