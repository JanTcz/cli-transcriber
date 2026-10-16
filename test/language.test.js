import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_TOOLS, looseMarkers, markersIn, placeholdersIn, suggest } from '../src/language.js';
import { compile } from '../src/project.js';
import { BASIC, brief, project } from './helpers.js';

const problemsOf = (t, files) => brief(compile(project(t, files)).problems);
const outputOf = (t, files, rel) => compile(project(t, files)).outputs.get(rel);
const body = (s) => s.slice(s.indexOf('-->') + 5);

test('markersIn: kinds, names, arguments quoted or bare, escapes', () => {
  const [a, b, c] = markersIn('x {{partial:p a="1 2" b=\'x\' c=bare}} {{ skill:s }} \\{{agent:z}}');
  assert.deepEqual([a.kind, a.name, a.args, a.escaped], ['partial', 'p', { a: '1 2', b: 'x', c: 'bare' }, false]);
  assert.deepEqual([b.kind, b.name, b.raw], ['skill', 's', '{{ skill:s }}']);
  assert.deepEqual([c.kind, c.escaped], ['agent', true]);
  assert.deepEqual(markersIn('no markers {{ here }}'), []);
});

test('looseMarkers, placeholdersIn, suggest', () => {
  assert.deepEqual(looseMarkers('{{partial:ok}} {{partial:broken'), [15]);
  assert.deepEqual(looseMarkers('\\{{partial:x'), []);
  assert.deepEqual(placeholdersIn('{{a}} {{ b }} \\{{c}} ${{ d }} {{e.f}}').map((p) => p.name), ['a', 'b']);
  assert.equal(suggest('reveiw', ['review', 'other']), ' (did you mean "review"?)');
  assert.equal(suggest('zzz', ['review']), '');
  assert.equal(suggest('x', []), '');
  assert.ok(KNOWN_TOOLS.includes('Bash'));
});

test('rendering: partials with params and defaults, indentation, names, escapes', (t) => {
  const out = outputOf(t, BASIC, '.claude/skills/review/SKILL.md');
  assert.equal(body(out), '# Review\n\n1. Read it.\n   Every finding needs a source.\n   A file and line will do.\nAsk checker.\n');
  const files = {
    ...BASIC,
    'skills/review.skill.yaml': `name: review
description: d
imports:
  partials: [cite, inline]
body: |
  Note: {{partial:inline}} and {{partial:inline who="Bo"}}.
  {{partial:cite}}

  \\{{partial:cite}} \${{ github.sha }}
`,
    'partials/inline.partial.yaml': 'name: inline\nparams:\n  who: { default: "Al" }\nbody: "hi {{who}} \\\\{{x}}"\n',
  };
  assert.equal(body(outputOf(t, files, '.claude/skills/review/SKILL.md')), 'Note: hi Al {{x}} and hi Bo {{x}}.\nEvery claim needs a source.\nA file and line will do.\n\n{{partial:cite}} ${{ github.sha }}\n');
});

test('rendering: partials inside partials, params passed on, values are text', (t) => {
  const files = {
    'skills/s.skill.yaml': 'name: s\ndescription: d\nimports:\n  partials: [outer]\nbody: |\n  {{partial:outer role="admin {{partial:x}}"}}\n',
    'partials/outer.partial.yaml': 'name: outer\nimports:\n  partials: [inner]\n  skills: [s]\nparams:\n  - name: role\nbody: |\n  Outer for {{skill:s}}:\n    {{partial:inner who="{{role}}"}}\n',
    'partials/inner.partial.yaml': 'name: inner\nparams:\n  - name: who\nbody: |\n  - one {{who}}\n\n  - two\n',
  };
  // A blank line in an indented partial stays blank, without trailing spaces.
  assert.equal(body(outputOf(t, files, '.claude/skills/s/SKILL.md')), 'Outer for s:\n  - one admin {{partial:x}}\n\n  - two\n');
});

test('checks: everything used exists and is imported, everything imported is used', (t) => {
  assert.deepEqual(problemsOf(t, {
    ...BASIC,
    'skills/review.skill.yaml': `name: review
description: d
imports:
  partials: [cite, cite, nope]
  skills: [review]
  agents: [checker]
body: |
  {{partial:cit}} {{agent:checker}} {{skill:review x=1}}
  {{partial:cite}} {{skill:ghost}} {{agnt:checker}}
`,
  }), [
    'skills/review.skill.yaml:4 imports partial "nope", which doesn\'t exist',
    'skills/review.skill.yaml:4 imports.partials lists "cite" twice',
    'skills/review.skill.yaml:8 {{skill:…}} takes no parameters',
    'skills/review.skill.yaml:8 partial "cit" doesn\'t exist (did you mean "cite"?)',
    'skills/review.skill.yaml:9 partial "cite" has several lines, so its marker must be alone on its line',
    'skills/review.skill.yaml:9 skill "ghost" doesn\'t exist',
    'skills/review.skill.yaml:9 unknown marker {{agnt:…}}; markers are partial, skill and agent (did you mean "agent"?)',
  ]);
  assert.deepEqual(problemsOf(t, { ...BASIC, 'skills/review.skill.yaml': 'name: review\ndescription: d\nimports:\n  skills: [review]\nbody: "{{partial:cite}} {{agent:checker}}"\n' }), [
    'skills/review.skill.yaml:4 imports skill "review" but never uses it: add {{skill:review}} or remove the import',
    'skills/review.skill.yaml:5 partial "cite" has several lines, so its marker must be alone on its line',
    'skills/review.skill.yaml:5 uses agent "checker" without importing it: add it to imports.agents',
    'skills/review.skill.yaml:5 uses partial "cite" without importing it: add it to imports.partials',
  ]);
});

test('checks: parameters of the partial and of the call', (t) => {
  assert.deepEqual(problemsOf(t, {
    'skills/s.skill.yaml': 'name: s\ndescription: d\nimports:\n  partials: [p]\nbody: |\n  {{partial:p wat=1}}\n',
    'partials/p.partial.yaml': 'name: p\nparams:\n  - name: what\n  - name: spare\n    default: x\nbody: "{{what}} {{wht}}"\n',
  }), [
    'partials/p.partial.yaml:4 parameter "spare" is never used in the body',
    'partials/p.partial.yaml:6 {{wht}} is not a parameter of this partial (did you mean "what"?); declare it under params, or write \\{{ for a literal {{',
    'skills/s.skill.yaml:6 partial "p" has no parameter "wat" (did you mean "what"?)',
    'skills/s.skill.yaml:6 partial "p" needs parameter "what"',
  ]);
});

test('checks: loops, duplicates, unused partials, garbled markers', (t) => {
  const r = problemsOf(t, {
    'skills/s.skill.yaml': 'name: s\ndescription: d\nimports:\n  partials: [a]\nbody: |\n  {{partial:a}}\n  {{partial:a broken\n',
    'partials/a.partial.yaml': 'name: a\nimports:\n  partials: [b]\nbody: "{{partial:b}}"\n',
    'partials/b.partial.yaml': 'name: b\nimports:\n  partials: [a]\nbody: "{{partial:a}}"\n',
    'partials/self.partial.yaml': 'name: self\nimports:\n  partials: [self]\nbody: "{{partial:self}}"\n',
    'partials/lonely.partial.yaml': 'name: lonely\nbody: x\n',
    // Two partials sharing a third: no loop, and the third is checked once.
    'skills/d.skill.yaml': 'name: d\ndescription: d\nimports:\n  partials: [left, right]\nbody: "{{partial:left}} {{partial:right}}"\n',
    'partials/left.partial.yaml': 'name: left\nimports:\n  partials: [shared]\nbody: "{{partial:shared}}"\n',
    'partials/right.partial.yaml': 'name: right\nimports:\n  partials: [shared]\nbody: "{{partial:shared}}"\n',
    'partials/shared.partial.yaml': 'name: shared\nbody: s\n',
    'other/a.partial.yaml': 'name: a\nbody: x\n',
  });
  assert.deepEqual(r, [
    'partials/a.partial.yaml:1 partial "a" is also defined in other/a.partial.yaml',
    'partials/b.partial.yaml:1 partial "b" is not used anywhere',
    'partials/lonely.partial.yaml:1 partial "lonely" is not used anywhere',
    'partials/self.partial.yaml:4 partials include each other in a loop: self → self',
    'skills/s.skill.yaml:7 a marker that doesn\'t parse: {{partial:a broken…',
  ]);
  // An unused partial is a warning: nothing else wrong, the build goes on.
  const ok = compile(project(t, { ...BASIC, 'partials/spare.partial.yaml': 'name: spare\nbody: x\n' }));
  assert.deepEqual([ok.problems.map((p) => p.level), Boolean(ok.outputs)], [['warning'], true]);
});

test('checks: tool names in allowed-tools and agent tools', (t) => {
  const files = {
    'skills/s.skill.yaml': 'name: s\ndescription: d\nfrontmatter:\n  allowed-tools: Read, Bash(git diff:*) mcp__github__get_pr Mine\nbody: x\n',
    'skills/t.skill.yaml': 'name: t\ndescription: d\nfrontmatter:\n  allowed-tools: [Wirte, mcp__srv]\nbody: x\n',
    'agents/a.agent.yaml': 'name: a\ndescription: d\nfrontmatter:\n  tools: "Read, Grpe"\nbody: x\n',
    'agents/b.agent.yaml': 'name: b\ndescription: d\nfrontmatter:\n  tools: 3\nbody: x\n',
    'agents/c.agent.yaml': 'name: c\ndescription: d\nbody: x\n',
  };
  assert.deepEqual(problemsOf(t, files), [
    'agents/a.agent.yaml:4 unknown tool "Grpe" (did you mean "Grep"?); if it is yours, add it to tools in transcriber.yaml',
    'skills/s.skill.yaml:4 unknown tool "Mine"; if it is yours, add it to tools in transcriber.yaml',
    'skills/t.skill.yaml:4 unknown tool "Wirte" (did you mean "Write"?); if it is yours, add it to tools in transcriber.yaml',
  ]);
  assert.equal(problemsOf(t, { ...files, 'transcriber.yaml': 'tools: [Mine, Wirte, Grpe]\n' }).length, 0);
});
