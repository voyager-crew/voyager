/**
 * create-voyager-plugin: scaffold and check a Voyager local plugin offline.
 * The checks are the extension's own modules bundled into this file, so
 * `check` applies the popup's import rules after resolving contributor
 * engine notation.
 */
import { PLUGIN_ENGINE_VERSION } from '../../../src/features/plugins/constants';
import { renderWriteVoyagerPluginSkill } from '../../../src/features/plugins/local/authoring/authoringDocs';
import { WRITE_PLUGIN_SKILL_URL } from '../../../src/features/plugins/local/authoring/skillLink';
import { DEFAULT_ADAPTERS } from '../../../src/features/plugins/sites/registry';
import { EFFECTIVE_PLUGIN_ENGINE_VERSION } from '../../../src/features/plugins/verbs/contracts';
import { checkPluginDir, formatIssue } from './check';
import { initPluginDir } from './init';
import { writeCreatePagesDir, writeSkillDir } from './skill';

const USAGE = `Usage: create-voyager-plugin <command>

  init [dir] --site <site> [--force]  Write plugin.json, style.css and AGENTS.md
  check [dir] [--json]                Run the popup's import checks (exit 0 = imports)
  skill [--out <dir>]                 Print the write-voyager-plugin skill, or write its files
  create-pages --out <dir>            Write the page a chat AI reads for each site
  --version                           Print its version and the Voyager version it checks for

Sites: ${DEFAULT_ADAPTERS.map((site) => site.id).join(', ')}
Guide: ${WRITE_PLUGIN_SKILL_URL}`;

class UsageError extends Error {}

interface ParsedArgs {
  readonly positional: string[];
  readonly flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(['--site', '--out']);

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.split(/=(.*)/s, 2);
    if (VALUE_FLAGS.has(name)) {
      const value = inline ?? argv[++index];
      if (value === undefined) throw new UsageError(`${name} needs a value`);
      flags.set(name, value);
    } else {
      flags.set(name, true);
    }
  }
  return { positional, flags };
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

async function runCheck(args: ParsedArgs): Promise<number> {
  const dir = args.positional[0] ?? '.';
  const outcome = await checkPluginDir(dir);
  if (args.flags.has('--json')) {
    process.stdout.write(`${JSON.stringify(outcome.issues, null, 2)}\n`);
  } else if (outcome.accepted) {
    process.stdout.write(
      `${dir}: OK, imports as ${outcome.accepted.id} ${outcome.accepted.version}\n`,
    );
  } else {
    process.stdout.write(`${dir}: would not import. Fix these and run check again:\n`);
    for (const issue of outcome.issues) process.stdout.write(`  ${formatIssue(issue)}\n`);
  }
  return outcome.accepted ? 0 : 1;
}

function runInit(args: ParsedArgs): number {
  const siteId = stringFlag(args, '--site');
  const ids = DEFAULT_ADAPTERS.map((site) => site.id).join(', ');
  if (!siteId) throw new UsageError(`init needs --site <site> (one of: ${ids})`);
  const site = DEFAULT_ADAPTERS.find((candidate) => candidate.id === siteId);
  if (!site) throw new UsageError(`unknown site "${siteId}" (one of: ${ids})`);
  const dir = args.positional[0] ?? 'voyager-plugin';
  const result = initPluginDir(dir, site, { force: args.flags.has('--force') });
  process.stdout.write(
    `Wrote ${result.written.join(', ')} to ${result.dir}\n` +
      `Next: edit them, then run "create-voyager-plugin check ${dir}".\n`,
  );
  return 0;
}

function runSkill(args: ParsedArgs): number {
  const out = stringFlag(args, '--out');
  if (!out) {
    process.stdout.write(renderWriteVoyagerPluginSkill(DEFAULT_ADAPTERS));
    return 0;
  }
  writeSkillDir(out, DEFAULT_ADAPTERS);
  return 0;
}

function runCreatePages(args: ParsedArgs): number {
  const out = stringFlag(args, '--out');
  if (!out) throw new UsageError('create-pages needs --out <dir>');
  writeCreatePagesDir(out, DEFAULT_ADAPTERS);
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.flags.has('--version') || args.flags.has('-v')) {
    process.stdout.write(
      `create-voyager-plugin ${PLUGIN_ENGINE_VERSION} (checks plugins for Voyager ${EFFECTIVE_PLUGIN_ENGINE_VERSION})\n`,
    );
    return 0;
  }
  const [command, ...rest] = args.positional;
  const help = args.flags.has('--help') || args.flags.has('-h');
  if (!command || help) {
    process.stdout.write(`${USAGE}\n`);
    return help ? 0 : 2;
  }
  const commandArgs = { ...args, positional: rest };
  if (command === 'check') return runCheck(commandArgs);
  if (command === 'init') return runInit(commandArgs);
  if (command === 'skill') return runSkill(commandArgs);
  if (command === 'create-pages') return runCreatePages(commandArgs);
  throw new UsageError(`unknown command "${command}"`);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`create-voyager-plugin: ${message}\n`);
    if (error instanceof UsageError) process.stderr.write(`\n${USAGE}\n`);
    process.exitCode = 2;
  },
);
