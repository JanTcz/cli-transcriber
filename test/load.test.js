import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, NAME, SHAPES, discover, load, problem } from '../src/load.js';
import { RULE, RULE_BODY, brief, project } from './helpers.js';

const one = (t, file, content) => load(project(t, { [file]: content }), file);

test('discover: the four kinds, in the given folders, not in node_modules, .git or skipped folders', (t) => {
  const dir = project(t, {
    'a/x.skill.yaml': '',
    'a/y.agent.yml': '',
    'b/z.partial.yaml': '',
    'c/shared/w.rule.yaml': '',
    'c/shared/w.rule.md': '',
    'a/notes.yaml': '',
    'node_modules/m/p.skill.yaml': '',
    '.git/q.skill.yaml': '',
    'out/skills/r.skill.yaml': '',
  });
  assert.deepEqual(discover(dir, ['.'], ['out']), ['a/x.skill.yaml', 'a/y.agent.yml', 'b/z.partial.yaml', 'c/shared/w.rule.yaml']);
  assert.deepEqual(discover(dir, ['b', 'b', 'missing']), ['b/z.partial.yaml']);
  assert.deepEqual(KINDS, ['skill', 'agent', 'partial', 'rule']);
  assert.ok(NAME.test('a.b_c-1') && !NAME.test('A') && !NAME.test('-a'));
  assert.deepEqual(problem('f', 2, 'm'), { level: 'error', file: 'f', line: 2, message: 'm' });
});

test('load: a skill with its imports, frontmatter and blocks in reading order', (t) => {
  const { doc, problems } = one(
    t,
    'skills/s.skill.yaml',
    `$kind: skill
name: s
description: d
imports:
  partials: [p]
  agents: [a]
frontmatter:
  allowed-tools: Read
metadata:
  owner: me
prose_blocks:
  - placement: skill-outro
    body: |
      outro
  - body: middle
  - placement: checklist
    body: list
  - placement: skill-intro
    body: |
      intro
`,
  );
  assert.deepEqual(problems, []);
  assert.equal(doc.kind, 'skill');
  assert.equal(doc.name, 's');
  assert.deepEqual(doc.imports, { partials: [{ name: 'p', line: 5 }], skills: [], agents: [{ name: 'a', line: 6 }], rules: [] });
  assert.deepEqual(doc.blocks.map((b) => b.text.trim()), ['intro', 'middle', 'list', 'outro']);
  // Lines inside a block scalar start on the line after the indicator.
  assert.equal(doc.textLine(doc.blocks[0].at, 0), 20);
  assert.equal(doc.textLine(doc.blocks[1].at, 0), 15);
  assert.equal(doc.lineOf(['nope', 'deeper']), 1);
});

test('load: a partial, with params as a list or a map', (t) => {
  const list = one(t, 'p.partial.yaml', 'name: p\nparams:\n  - name: a\n    description: first\n  - name: b\n    default: 3\nbody: "{{a}} {{b}}"\n');
  assert.deepEqual(list.doc.params, [
    { name: 'a', description: 'first', hasDefault: false, default: '', line: 3 },
    { name: 'b', description: null, hasDefault: true, default: '3', line: 5 },
  ]);
  const asMap = one(t, 'p.partial.yaml', 'name: p\nparams:\n  a: { description: x }\n  b: plain\n  c: { default: null }\nbody: x\n');
  assert.deepEqual(asMap.doc.params.map((p) => [p.name, p.hasDefault, p.default]), [['a', false, ''], ['b', true, 'plain'], ['c', true, '']]);
  assert.deepEqual(one(t, 'p.partial.yaml', 'name: p\nbody: x\n').doc.params, []);
  assert.equal(one(t, 'p.partial.yaml', 'name: p\nbody: x\n').doc.blocks[0].text, 'x');
});

test('load: YAML errors, a document that is not a map, an empty one', (t) => {
  assert.deepEqual(brief(one(t, 'x.skill.yaml', 'name: x\nname: y\n').problems), ['x.skill.yaml:2 YAML: Map keys must be unique']);
  assert.deepEqual(brief(one(t, 'x.skill.yaml', '- a\n- b\n').problems), ['x.skill.yaml:1 a skill is a map of fields']);
  assert.deepEqual(brief(one(t, 'x.agent.yaml', '').problems), [
    'x.agent.yaml:1 "name" is required',
    'x.agent.yaml:1 "description" is required',
    'x.agent.yaml:1 an agent needs "body" or "prose_blocks" (one of them)',
  ]);
});

test('load: the shape of each field', (t) => {
  const { doc, problems } = one(
    t,
    'skills/x.skill.yaml',
    `$kind: agent
name: X
description: "${'d'.repeat(1025)}"
imports: [a]
frontmatter:
  name: x
  description: y
body: b
prose_blocks: nope
stages: []
`,
  );
  assert.equal(doc, null);
  assert.deepEqual(brief(problems), [
    'skills/x.skill.yaml:4 "imports" must be a map of partials, skills, agents, rules',
    'skills/x.skill.yaml:9 "prose_blocks" must be a list of { placement, body }',
    'skills/x.skill.yaml:10 unknown field "stages" in a skill; put your own fields under "metadata"',
    'skills/x.skill.yaml:1 $kind is "agent" but the file is a .skill.yaml',
    'skills/x.skill.yaml:2 name "X" must be lowercase letters, digits, ".", "_" or "-"',
    'skills/x.skill.yaml:3 description is 1025 characters; agents read at most 1024',
    'skills/x.skill.yaml:1 a skill needs "body" or "prose_blocks" (one of them)',
    'skills/x.skill.yaml:6 frontmatter.name comes from the top-level "name"; remove it here',
    'skills/x.skill.yaml:7 frontmatter.description comes from the top-level "description"; remove it here',
  ]);
});

test('load: names, descriptions, imports, prose blocks, params that are wrong', (t) => {
  const s = one(t, 'a/right.skill.yaml', 'name: wrong\ndescription: "  "\nimports:\n  tools: [Read]\n  partials: p\n  skills: [1]\nprose_blocks:\n  - body: ok\n  - placement: 3\n    body: x\n  - just text\nbody: also\n');
  assert.deepEqual(brief(s.problems), [
    'a/right.skill.yaml:1 name "wrong" must match the file name "right"',
    'a/right.skill.yaml:2 description is empty',
    'a/right.skill.yaml:4 imports can list partials, skills, agents, rules; not "tools"',
    'a/right.skill.yaml:5 imports.partials must be a list of names',
    'a/right.skill.yaml:6 imports.skills must be a list of names',
    'a/right.skill.yaml:1 a skill needs "body" or "prose_blocks" (one of them)',
    'a/right.skill.yaml:9 a prose block is { placement, body } with text in body',
    'a/right.skill.yaml:11 a prose block is { placement, body } with text in body',
  ]);
  const p = one(t, 'p.partial.yaml', 'name: p\nparams:\n  - description: no name\n  - name: "has space"\n  - name: ok\n    default: { a: 1 }\nbody: 7\n');
  assert.deepEqual(brief(p.problems), [
    'p.partial.yaml:7 "body" must be text',
    'p.partial.yaml:3 a parameter needs a name (letters, digits, _ and -)',
    'p.partial.yaml:4 a parameter needs a name (letters, digits, _ and -)',
    'p.partial.yaml:5 the default of parameter "ok" must be text, a number or a boolean',
  ]);
  assert.deepEqual(brief(one(t, 'p.partial.yaml', 'name: p\nparams: 3\nbody: x\n').problems), ['p.partial.yaml:2 "params" must be a list of { name, description, default } or a map']);
  assert.equal(one(t, 'n.skill.yaml', 'name: 5\ndescription: 6\nbody: x\n').problems.length, 2);
  assert.ok(SHAPES.partial.body.required);
});

test('load: a rule as the framework writes it, unconverted: its body is the text, the rest is metadata', (t) => {
  const { doc, problems } = one(t, 'rules/shared/leave-it-better.rule.yaml', RULE);
  assert.deepEqual(problems, []);
  assert.deepEqual([doc.kind, doc.name, doc.params, doc.imports], ['rule', 'leave-it-better', [], { partials: [], skills: [], agents: [], rules: [] }]);
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0].text.trimEnd(), RULE_BODY);
  assert.deepEqual([doc.data.title, doc.data.severity, doc.data.scope], ['Leave it better', 'SHOULD', 'universal']);
  // Every other field the framework's rules carry, in each of the forms they take there.
  const full = one(
    t,
    'r.rule.yml',
    `name: r
description: d
title: T
version: 2
status: done
owner: me/
deprecated: "use other-rule instead"
scope: stack
severity: MAY
reflex: "do it"
subagent_reflex: false
discipline: general
layer: atomic
examples: [a, { code: x, comment: y }]
anti_examples: []
cross_links: [wiki/x.md]
removal_predicate: "remove if recurrences == 0 for 90d"
enforced_by: [hook-a, hook-b]
enforcement_status: advisory
enforcement_rationale: "review-time judgment"
metadata: { mine: 1 }
body: x
`,
  );
  assert.deepEqual(full.problems, []);
  assert.equal(full.doc.blocks[0].text, 'x');
  for (const enforcedBy of ['hook-a', 'null']) assert.deepEqual(one(t, 'r.rule.yaml', `name: r\nenforced_by: ${enforcedBy}\nbody: x\n`).problems, []);
});

test('load: a rule is checked as strictly as the other kinds', (t) => {
  const { doc, problems } = one(
    t,
    'rules/r.rule.yaml',
    `$kind: skill
name: other
title: 3
version: [1]
deprecated: 3
severity: { level: MUST }
subagent_reflex: "yes"
cross_links: a.md
enforced_by: [1]
imports:
  partials: [p]
prose_blocks: []
stages: []
`,
  );
  assert.equal(doc, null);
  assert.deepEqual(brief(problems), [
    'rules/r.rule.yaml:1 "body" is required',
    'rules/r.rule.yaml:3 "title" must be text',
    'rules/r.rule.yaml:4 "version" must be text or a number',
    'rules/r.rule.yaml:5 "deprecated" must be text or null',
    'rules/r.rule.yaml:6 "severity" must be text',
    'rules/r.rule.yaml:7 "subagent_reflex" must be true or false',
    'rules/r.rule.yaml:8 "cross_links" must be a list',
    'rules/r.rule.yaml:9 "enforced_by" must be a name, a list of names or null',
    'rules/r.rule.yaml:11 unknown field "imports" in a rule; put your own fields under "metadata"',
    'rules/r.rule.yaml:12 unknown field "prose_blocks" in a rule; put your own fields under "metadata"',
    'rules/r.rule.yaml:13 unknown field "stages" in a rule; put your own fields under "metadata"',
    'rules/r.rule.yaml:1 $kind is "skill" but the file is a .rule.yaml',
    'rules/r.rule.yaml:2 name "other" must match the file name "r"',
  ]);
  assert.deepEqual(brief(one(t, 'r.rule.yaml', 'body: 7\n').problems), ['r.rule.yaml:1 "name" is required', 'r.rule.yaml:1 "body" must be text']);
  // A rule's description is metadata, not frontmatter: no length limit.
  assert.deepEqual(one(t, 'r.rule.yaml', `name: r\ndescription: "${'d'.repeat(1025)}"\nbody: x\n`).problems, []);
});
