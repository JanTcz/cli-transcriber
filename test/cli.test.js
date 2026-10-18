import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { USAGE, UsageError, VERSION, formatText, init, main, parseArgs } from '../src/cli.js';
import { CONFIG } from '../src/project.js';
import { BASIC, SHORT_RULE, exists, project, read, sink, write } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/cli-transcriber.js', import.meta.url));

async function cli(args, { cwd, tty = false } = {}) {
  const stdout = sink(tty);
  const stderr = sink();
  const code = await main(args, { stdout, stderr, cwd });
  return { code, out: stdout.text, err: stderr.text, json: () => JSON.parse(stdout.text) };
}

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['build', '--root', 'x', '--force', '--json=1', '-h']), { flags: { root: 'x', force: true, json: '1', help: true }, positional: ['build'] });
  assert.throws(() => parseArgs(['--root']), UsageError);
});

test('--help, help, no command, --version', async (t) => {
  const cwd = project(t);
  for (const args of [['--help'], ['help'], [], ['-h']]) assert.equal((await cli(args, { cwd })).out, USAGE);
  assert.equal((await cli(['--version'], { cwd })).out, `${VERSION}\n`);
});

test('build and check: JSON on a pipe, text on a terminal, exit codes', async (t) => {
  const cwd = project(t, BASIC);
  const outdated = await cli(['check'], { cwd, tty: true });
  assert.equal(outdated.code, 1);
  assert.equal(outdated.out, '.claude/agents/checker.md  missing\n.claude/skills/review/SKILL.md  missing\n✖ 2 outputs out of date: run cli-transcriber build\n');
  const built = await cli(['build'], { cwd });
  assert.deepEqual([built.code, built.json().written.length], [0, 2]);
  assert.equal((await cli(['build', '--text'], { cwd })).out, '✔ 0 files written, 0 removed, 2 unchanged\n');
  const ok = await cli(['check'], { cwd, tty: true });
  assert.deepEqual([ok.code, ok.out], [0, '✔ every source checks out and every output is up to date\n']);
  assert.equal((await cli(['check', '--json'], { cwd, tty: true })).json().ok, true);
});

test('text: problems, warnings, written and removed files', async (t) => {
  const cwd = project(t, { ...BASIC, 'partials/spare.partial.yaml': 'name: spare\nbody: x\n' });
  const first = await cli(['build', '--text'], { cwd });
  assert.equal(first.out, 'partials/spare.partial.yaml:1  warning  partial "spare" is not used anywhere\n  wrote .claude/agents/checker.md\n  wrote .claude/skills/review/SKILL.md\n✔ 2 files written, 0 removed, 0 unchanged (1 warning)\n');
  assert.match((await cli(['check', '--text'], { cwd })).out, /✔ every source checks out and every output is up to date \(1 warning\)\n$/);
  write(cwd, { 'agents/checker.agent.yaml': 'name: checker\ndescription: d\nbody: b\n' });
  const rewritten = await cli(['build', '--text'], { cwd });
  assert.match(rewritten.out, /\n {2}wrote \.claude\/agents\/checker\.md\n✔ 1 file written/);
  write(cwd, { 'skills/review.skill.yaml': 'name: review\nbody: |\n  {{partial:nope}}\n' });
  const broken = await cli(['build'], { cwd, tty: true });
  assert.equal(broken.code, 1);
  assert.equal(
    broken.out,
    'partials/cite.partial.yaml:1  warning  partial "cite" is not used anywhere\npartials/spare.partial.yaml:1  warning  partial "spare" is not used anywhere\nskills/review.skill.yaml:1  error  "description" is required\n✖ 1 error, 2 warnings; nothing written\n',
  );
  assert.equal((await cli(['check', '--text'], { cwd })).out.split('\n').at(-2), '✖ 1 error, 2 warnings');
  const removed = project(t, BASIC);
  await cli(['build'], { cwd: removed });
  write(removed, { 'agents/checker.agent.yaml': '' });
  assert.match(formatText({ op: 'build', ok: true, problems: [], written: [], removed: ['.claude/agents/checker.md'], unchanged: 1 }), /^ {2}removed \.claude\/agents\/checker\.md\n✔ 0 files written, 1 removed, 1 unchanged$/);
});

test('show: the rendered file, or the problems', async (t) => {
  const cwd = project(t, BASIC);
  const s = await cli(['show', 'review', '--text'], { cwd });
  assert.equal(s.code, 0);
  assert.match(s.out, /^---\nname: review\n[\s\S]*Ask checker\.\n$/);
  const missing = await cli(['show', 'nope', '--text'], { cwd });
  assert.deepEqual([missing.code, missing.out], [1, 'transcriber.yaml  error  no skill, agent or rule named "nope"\n✖ 1 error\n']);
  assert.equal((await cli(['show', 'checker'], { cwd })).json().kind, 'agent');
  write(cwd, { 'rules/cite-it.rule.yaml': SHORT_RULE });
  assert.deepEqual((await cli(['show', 'rule:cite-it'], { cwd })).json(), {
    op: 'show',
    ok: true,
    problems: [],
    kind: 'rule',
    name: 'cite-it',
    source: 'rules/cite-it.rule.yaml',
    content: 'Cite a file and line for every claim.\n',
  });
  assert.equal((await cli(['show', 'cite-it', '--text'], { cwd })).out, 'Cite a file and line for every claim.\n');
});

test('init: the config and an example that builds, never overwriting', async (t) => {
  const cwd = project(t);
  const r = await cli(['init', '--text'], { cwd });
  assert.equal(r.out, `created ${CONFIG}, skills/review.skill.yaml, partials/cite-sources.partial.yaml\n`);
  assert.equal((await cli(['build'], { cwd })).code, 0);
  assert.match(read(cwd, '.claude/skills/review/SKILL.md'), /Every finding needs a source: a file and line/);
  assert.equal((await cli(['init', '--text'], { cwd })).out, 'nothing to create: the files exist\n');
  assert.deepEqual(init(cwd).created, []);
  assert.ok(exists(cwd, CONFIG));
});

test('errors: bad arguments and config exit 2, others are thrown', async (t) => {
  const cwd = project(t, { [CONFIG]: 'targets: [cursor]\n' });
  for (const args of [['frobnicate'], ['build', 'extra'], ['show'], ['show', 'a', 'b'], ['--root']]) {
    const r = await cli(args, { cwd: project(t) });
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, /^cli-transcriber: /);
  }
  const config = await cli(['check'], { cwd });
  assert.deepEqual([config.code, config.err], [2, 'cli-transcriber: transcriber.yaml: unknown target "cursor"; targets are claude, codex and plugin:<folder>\n']);
  // A folder that doesn't exist is an empty project; a file where a folder must go is not ours to handle.
  assert.equal((await cli(['check', '--root=missing'], { cwd: project(t) })).code, 0);
  await assert.rejects(cli(['build'], { cwd: project(t, { ...BASIC, '.claude': 'a file' }) }), /ENOTDIR|EEXIST/);
});

test('--root and the process defaults', async (t) => {
  const dir = project(t, BASIC);
  assert.equal((await cli(['build', `--root=${dir}`], { cwd: '/' })).code, 0);
  const write = process.stdout.write;
  let out = '';
  process.stdout.write = (s) => ((out += s), true);
  try {
    assert.equal(await main(['--version']), 0);
  } finally {
    process.stdout.write = write;
  }
  assert.equal(out, `${VERSION}\n`);
});

test('the bin runs the CLI and sets the exit code', (t) => {
  const cwd = project(t, BASIC);
  const r = spawnSync(process.execPath, [BIN, 'check'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).outdated.length, 2);
  assert.equal(spawnSync(process.execPath, [BIN, 'nope'], { cwd, encoding: 'utf8' }).status, 2);
});
