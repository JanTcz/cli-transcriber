// The `cli-transcriber` command. JSON on a pipe (or with --json), text on a terminal.

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ConfigError, build, check, show } from './project.js';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const USAGE = `cli-transcriber ${VERSION}: skills and agents from YAML sources, with partials and checked references

Usage: cli-transcriber <command> [--root=dir] [--json|--text]

  build        check every source, then write the skills and agents (and remove stale ones)
    --force    overwrite files at output paths that cli-transcriber didn't write
  check        check every source and that every output is up to date; writes nothing (CI)
  show NAME    print one skill or agent as it would be written (skill:NAME or agent:NAME if both exist)
  init         create ${CONFIG} and an example skill and partial

Sources: *.skill.yaml, *.agent.yaml, *.partial.yaml under the folders in ${CONFIG} (default: all).
Exit: 0 fine, 1 problems in the sources or outdated outputs, 2 bad arguments or config.
`;

export class UsageError extends Error {}

const BOOLEAN = new Set(['json', 'text', 'help', 'version', 'force']);

export function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h') flags.help = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (eq !== -1) flags[name] = a.slice(eq + 1);
      else if (BOOLEAN.has(name)) flags[name] = true;
      else if (i + 1 < args.length) flags[name] = args[++i];
      else throw new UsageError(`--${name} needs a value`);
    } else positional.push(a);
  }
  return { flags, positional };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatText(r) {
  const lines = r.problems.map((p) => `${p.file}${p.line ? `:${p.line}` : ''}  ${p.level}  ${p.message}`);
  const errors = r.problems.filter((p) => p.level === 'error').length;
  const warnings = r.problems.length - errors;
  const tally = [errors ? plural(errors, 'error') : null, warnings ? plural(warnings, 'warning') : null].filter(Boolean).join(', ');
  if (r.op === 'init') return r.created.length ? `created ${r.created.join(', ')}` : 'nothing to create: the files exist';
  if (r.op === 'show') return r.ok ? r.content.trimEnd() : [...lines, `✖ ${tally}`].join('\n');
  if (errors && r.op !== 'check') return [...lines, `✖ ${tally}; nothing written`].join('\n');
  if (errors) return [...lines, `✖ ${tally}`].join('\n');
  if (r.op === 'build') {
    const done = `✔ ${plural(r.written.length, 'file')} written, ${r.removed.length} removed, ${r.unchanged} unchanged`;
    return [...lines, ...r.written.map((f) => `  wrote ${f}`), ...r.removed.map((f) => `  removed ${f}`), done + (tally ? ` (${tally})` : '')].join('\n');
  }
  if (!r.ok) return [...lines, ...r.outdated.map((o) => `${o.path}  ${o.why}`), `✖ ${plural(r.outdated.length, 'output')} out of date: run cli-transcriber build`].join('\n');
  return [...lines, `✔ every source checks out and every output is up to date${tally ? ` (${tally})` : ''}`].join('\n');
}

const EXAMPLE_CONFIG = `# cli-transcriber: where the sources are and what to write.
sources: [.]          # folders searched for *.skill.yaml, *.agent.yaml, *.partial.yaml
targets: [claude]     # claude (.claude/), codex (.agents/skills), plugin:<folder>
tools: []             # tool names of your own, besides Claude Code's and mcp__*
`;

const EXAMPLE_SKILL = `name: review
description: Review a change before it is merged. Use when asked to review a diff or a pull request.
imports:
  partials: [cite-sources]
body: |
  # Review

  Read the diff, then report what is wrong, most serious first.

  {{partial:cite-sources what="finding"}}
`;

const EXAMPLE_PARTIAL = `name: cite-sources
params:
  - name: what
    description: what needs a source
    default: claim
body: |
  Every {{what}} needs a source: a file and line, a command and its output, or a link.
`;

/** Creates the config and an example, never overwriting. */
export function init(root) {
  const files = { [CONFIG]: EXAMPLE_CONFIG, 'skills/review.skill.yaml': EXAMPLE_SKILL, 'partials/cite-sources.partial.yaml': EXAMPLE_PARTIAL };
  const created = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    created.push(rel);
  }
  return { op: 'init', ok: true, problems: [], created };
}

/**
 * @param {string[]} args  the arguments after the command name
 * @returns {Promise<number>} the exit code
 */
export async function main(args, io = {}) {
  const { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd() } = io;
  const isTTY = io.isTTY ?? Boolean(stdout.isTTY);
  try {
    const { flags, positional } = parseArgs(args);
    if (flags.version) {
      stdout.write(`${VERSION}\n`);
      return 0;
    }
    const [command, ...rest] = positional;
    if (flags.help || !command || command === 'help') {
      stdout.write(USAGE);
      return 0;
    }
    const root = path.resolve(cwd, flags.root ?? '.');
    let result;
    if (command === 'build' && !rest.length) result = build(root, { force: Boolean(flags.force) });
    else if (command === 'check' && !rest.length) result = check(root);
    else if (command === 'init' && !rest.length) result = init(root);
    else if (command === 'show' && rest.length === 1) result = show(root, rest[0]);
    else throw new UsageError(`unknown command "${positional.join(' ')}"; cli-transcriber --help lists them`);
    const json = flags.json || (!isTTY && !flags.text);
    stdout.write(`${json ? JSON.stringify(result, null, 2) : formatText(result)}\n`);
    return result.ok ? 0 : 1;
  } catch (err) {
    if (!(err instanceof UsageError || err instanceof ConfigError)) throw err;
    stderr.write(`cli-transcriber: ${err.message}\n`);
    return 2;
  }
}
