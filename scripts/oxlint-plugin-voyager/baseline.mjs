import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULE_IDS = [
  'voyager/no-real-sleep-in-tests',
  'voyager/no-per-test-timeout',
  'voyager/no-unlinked-skip',
];
const pluginDirectory = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = realpathSync(path.resolve(pluginDirectory, '../..'));
export const BASELINE_PATH = path.join(pluginDirectory, 'baseline.json');

export function isTestFile(filename) {
  return /(?:^|\/)__tests__\//.test(filename) || /\.test\.tsx?$/.test(filename);
}

export function relativeFilename(filename) {
  let absolute = path.resolve(REPOSITORY_ROOT, filename);
  try {
    // macOS exposes the same checkout through /tmp and /private/tmp.
    absolute = realpathSync(absolute);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return path.relative(REPOSITORY_ROOT, absolute).split(path.sep).join('/');
}

export function readBaseline(filename = BASELINE_PATH) {
  const baseline = JSON.parse(readFileSync(filename, 'utf8'));
  if (baseline?.version !== 1 || !baseline.rules || typeof baseline.rules !== 'object') {
    throw new Error(`Use a version 1 test-timing baseline: ${filename}`);
  }
  for (const [rule, files] of Object.entries(baseline.rules)) {
    if (!RULE_IDS.includes(rule) || !files || typeof files !== 'object' || Array.isArray(files)) {
      throw new Error(`Use known rule IDs and file/count maps in ${filename}`);
    }
    for (const [file, count] of Object.entries(files)) {
      if (
        path.isAbsolute(file) ||
        file.split('/').includes('..') ||
        !Number.isSafeInteger(count) ||
        count <= 0
      ) {
        throw new Error(`Use relative paths and positive integer counts in ${filename}`);
      }
    }
  }
  return baseline;
}

const committedBaseline = readBaseline();

/** The budget is per file and rule; visiting another file never consumes it. */
export function baselinedRule(ruleId, message, collect) {
  return {
    meta: {
      type: 'problem',
      docs: { description: message },
      schema: [
        {
          type: 'object',
          properties: { baseline: { anyOf: [{ type: 'string' }, { const: false }] } },
          additionalProperties: false,
        },
      ],
      messages: { fix: message },
    },
    create(context) {
      const filename = context.filename.replaceAll('\\', '/');
      if (!isTestFile(filename)) return {};
      return {
        'Program:exit'(program) {
          const nodes = [...new Set(collect(program, context.sourceCode))].sort(
            (a, b) => a.range[0] - b.range[0],
          );
          const option = context.options[0]?.baseline;
          const baseline =
            option === false
              ? undefined
              : typeof option === 'string'
                ? readBaseline(path.resolve(context.cwd, option))
                : committedBaseline;
          const relative = relativeFilename(filename);
          const allowance = baseline?.rules[ruleId]?.[relative] ?? 0;
          for (const node of nodes.slice(allowance)) context.report({ node, messageId: 'fix' });
        },
      };
    },
  };
}

/** Only lower existing allowances. New pairs and increased counts require review. */
export function tightenBaseline(previous, current) {
  return {
    version: 1,
    rules: Object.fromEntries(
      RULE_IDS.map((rule) => [
        rule,
        Object.fromEntries(
          Object.entries(previous.rules[rule] ?? {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([file, count]) => [file, Math.min(count, current.rules[rule]?.[file] ?? 0)])
            .filter(([, count]) => count > 0),
        ),
      ]),
    ),
  };
}
