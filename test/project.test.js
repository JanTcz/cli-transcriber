import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ConfigError, HEADER, build, check, compile, readConfig, show, targetDirs } from '../src/project.js';
import { BASIC, exists, project, read, write } from './helpers.js';

test('targetDirs: claude, codex, a plugin folder', () => {
  assert.deepEqual(targetDirs('claude'), { skills: '.claude/skills', agents: '.claude/agents' });
  assert.deepEqual(targetDirs('codex'), { skills: '.agents/skills', agents: null });
  assert.deepEqual(targetDirs('plugin:agents'), { skills: 'agents/skills', agents: 'agents/agents' });
  assert.equal(targetDirs('cursor'), null);
});

test('readConfig: defaults, settings, and what is wrong with them', (t) => {
  assert.deepEqual(readConfig(project(t)), { sources: ['.'], targets: ['claude'], tools: [] });
  assert.deepEqual(readConfig(project(t, { [CONFIG]: '' })).targets, ['claude']);
  assert.deepEqual(readConfig(project(t, { [CONFIG]: 'sources: [src]\ntargets: [codex, "plugin:p"]\n' })), { sources: ['src'], targets: ['codex', 'plugin:p'], tools: [] });
  const bad = (content, message) => assert.throws(() => readConfig(project(t, { [CONFIG]: content })), (e) => e instanceof ConfigError && message.test(e.message));
  bad('a: [', /^transcriber.yaml: /);
  bad('output: [x]\n', /unknown setting "output"/);
  bad('targets: claude\n', /targets must be a list of text/);
  bad('tools: [1]\n', /tools must be a list of text/);
  bad('targets: [cursor]\n', /unknown target "cursor"/);
});

test('compile: every target, the frontmatter, the header', (t) => {
  const dir = project(t, { ...BASIC, [CONFIG]: 'targets: [claude, codex, "plugin:dist"]\n' });
  const { outputs, problems } = compile(dir);
  assert.deepEqual(problems, []);
  assert.deepEqual([...outputs.keys()].sort(), [
    '.agents/skills/review/SKILL.md',
    '.claude/agents/checker.md',
    '.claude/skills/review/SKILL.md',
    'dist/agents/checker.md',
    'dist/skills/review/SKILL.md',
  ]);
  assert.equal(
    outputs.get('.claude/agents/checker.md'),
    `---\nname: checker\ndescription: Checks diffs.\nmodel: haiku\ntools:\n  - Read\n  - Grep\n---\n\n${HEADER} agents/checker.agent.yaml: edit the source, then run cli-transcriber build. -->\n\nRead the diff.\n`,
  );
  // A long description stays on one line.
  const long = 'x '.repeat(100).trim();
  const one = compile(project(t, { 'skills/s.skill.yaml': `name: s\ndescription: ${long}\nbody: b\n` }));
  assert.match(one.outputs.get('.claude/skills/s/SKILL.md'), new RegExp(`^---\\nname: s\\ndescription: ${long}\\n---`));
});

test('compile: outputs are not sources', (t) => {
  const dir = project(t, { ...BASIC, 'dist/skills/review/x.skill.yaml': 'not even yaml: [', [CONFIG]: 'targets: ["plugin:dist"]\n' });
  assert.deepEqual(compile(dir).problems, []);
});

test('build: writes, then leaves alone what is current, rewrites what changed', (t) => {
  const dir = project(t, BASIC);
  assert.deepEqual(build(dir), { op: 'build', ok: true, problems: [], written: ['.claude/agents/checker.md', '.claude/skills/review/SKILL.md'], removed: [], unchanged: 0 });
  assert.match(read(dir, '.claude/skills/review/SKILL.md'), /Every finding needs a source/);
  assert.deepEqual(build(dir).unchanged, 2);
  write(dir, { 'partials/cite.partial.yaml': read(dir, 'partials/cite.partial.yaml').replace('Every', 'Each') });
  assert.deepEqual(build(dir).written, ['.claude/skills/review/SKILL.md']);
  assert.match(read(dir, '.claude/skills/review/SKILL.md'), /Each finding/);
});

test('build: removes outputs whose source is gone, and nothing it did not write', (t) => {
  const dir = project(t, BASIC);
  build(dir);
  write(dir, { '.claude/skills/hand/SKILL.md': '# mine', '.claude/agents/notes.txt': 'x', '.claude/agents/mine.md': '# mine', '.claude/skills/review/extra.md': 'kept' });
  fs.rmSync(path.join(dir, 'agents/checker.agent.yaml'));
  write(dir, { 'skills/review.skill.yaml': 'name: review\ndescription: d\nbody: b\n' });
  fs.rmSync(path.join(dir, 'partials/cite.partial.yaml'));
  write(dir, { 'skills/gone.skill.yaml': 'name: gone\ndescription: d\nbody: b\n' });
  build(dir);
  fs.rmSync(path.join(dir, 'skills/gone.skill.yaml'));
  const r = build(dir);
  assert.deepEqual(r.removed, ['.claude/skills/gone/SKILL.md']);
  assert.ok(!exists(dir, '.claude/skills/gone'), 'an emptied skill folder goes too');
  assert.ok(exists(dir, '.claude/skills/hand/SKILL.md') && exists(dir, '.claude/agents/mine.md'));
  assert.ok(!exists(dir, '.claude/agents/checker.md'));
  fs.rmSync(path.join(dir, 'skills/review.skill.yaml'));
  assert.deepEqual(build(dir).removed, ['.claude/skills/review/SKILL.md']);
  assert.ok(exists(dir, '.claude/skills/review/extra.md'), 'a skill folder with other files stays');
});

test('build: never overwrites a file it did not write, unless forced; writes nothing when a source is wrong', (t) => {
  const dir = project(t, { ...BASIC, '.claude/skills/review/SKILL.md': '# written by hand' });
  const r = build(dir);
  assert.equal(r.ok, false);
  assert.match(r.problems[0].message, /was not generated by cli-transcriber/);
  assert.equal(read(dir, '.claude/skills/review/SKILL.md'), '# written by hand');
  assert.deepEqual(build(dir, { force: true }).written, ['.claude/agents/checker.md', '.claude/skills/review/SKILL.md']);
  const broken = project(t, { 'skills/s.skill.yaml': 'name: s\nbody: b\n' });
  assert.deepEqual([build(broken).ok, exists(broken, '.claude')], [false, false]);
});

test('check: up to date, or what is missing, changed, foreign or stale', (t) => {
  const dir = project(t, BASIC);
  assert.deepEqual(check(dir).outdated.map((o) => [o.path, o.why]), [
    ['.claude/agents/checker.md', 'missing'],
    ['.claude/skills/review/SKILL.md', 'missing'],
  ]);
  build(dir);
  assert.deepEqual(check(dir), { op: 'check', ok: true, problems: [], outdated: [] });
  write(dir, { '.claude/skills/review/SKILL.md': `${read(dir, '.claude/skills/review/SKILL.md')}edited\n`, '.claude/agents/checker.md': '# replaced by hand' });
  write(dir, { 'skills/old.skill.yaml': 'name: old\ndescription: d\nbody: b\n' });
  build(dir, { force: true });
  fs.rmSync(path.join(dir, 'skills/old.skill.yaml'));
  write(dir, { '.claude/skills/review/SKILL.md': `${read(dir, '.claude/skills/review/SKILL.md')}edited\n`, '.claude/agents/checker.md': '# replaced by hand' });
  const r = check(dir);
  assert.equal(r.ok, false);
  assert.deepEqual(r.outdated.map((o) => [o.path, o.why]), [
    ['.claude/agents/checker.md', 'not generated by cli-transcriber'],
    ['.claude/skills/old/SKILL.md', 'its source is gone'],
    ['.claude/skills/review/SKILL.md', 'differs from its source (edited by hand, or the source changed)'],
  ]);
  const broken = check(project(t, { 'skills/s.skill.yaml': 'name: s\nbody: b\n' }));
  assert.deepEqual([broken.ok, broken.problems.length, broken.outdated], [false, 1, []]);
});

test('show: one skill or agent, by name or kind:name', (t) => {
  const dir = project(t, { ...BASIC, 'agents/review.agent.yaml': 'name: review\ndescription: d\nbody: agent body\n' });
  const s = show(dir, 'review');
  assert.deepEqual([s.ok, s.kind, s.source], [true, 'skill', 'skills/review.skill.yaml']);
  assert.match(show(dir, 'agent:review').content, /agent body/);
  assert.equal(show(dir, 'checker').kind, 'agent');
  assert.equal(exists(dir, '.claude'), false, 'show writes nothing');
  const missing = show(dir, 'nope');
  assert.deepEqual([missing.ok, missing.problems.at(-1).message], [false, 'no skill or agent named "nope"']);
  assert.equal(show(project(t, { 'skills/s.skill.yaml': 'name: s\nbody: b\n' }), 's').ok, false);
});
