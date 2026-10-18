import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A project folder with these files, removed after the test. */
export function project(t, files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-transcriber-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  write(dir, files);
  return dir;
}

export function write(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
}

export const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
export const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

/** "file:line message" for each problem, the way a person reads them. */
export const brief = (problems) => problems.map((p) => `${p.file}:${p.line} ${p.message}`);

/** A writable stream stand-in that keeps what was written. */
export function sink(isTTY = false) {
  const chunks = [];
  return {
    isTTY,
    write: (s) => chunks.push(String(s)),
    get text() {
      return chunks.join('');
    },
  };
}

export const SKILL = `name: review
description: Review a change.
imports:
  partials: [cite]
  agents: [checker]
body: |
  # Review

  1. Read it.
     {{partial:cite what="finding"}}
  Ask {{agent:checker}}.
`;

export const PARTIAL = `name: cite
params:
  - name: what
    default: claim
body: |
  Every {{what}} needs a source.
  A file and line will do.
`;

export const AGENT = `name: checker
description: Checks diffs.
frontmatter:
  model: haiku
  tools: [Read, Grep]
body: Read the diff.
`;

export const BASIC = {
  'skills/review.skill.yaml': SKILL,
  'partials/cite.partial.yaml': PARTIAL,
  'agents/checker.agent.yaml': AGENT,
};

/** A rule as the framework writes it, unconverted: examples/team/rules/code-quality-leave-it-better.rule.yaml, renamed. */
export const RULE = `$kind: "rule"
$language_version: "0"

name: leave-it-better
title: "Leave it better"
version: 1.0.0
status: "active"
owner: rules/
deprecated: null
scope: universal
severity: SHOULD
subagent_reflex: true
reflex: "Leave touched code better than you found it."

body: |
  **Leave every file you touch in better shape than you found it.**

  Tidy what is cheap and safe to tidy while you are there: dead code, unused imports, a value written twice, a weak name.

  **Say it:** "Left better: [what] in [file]". Nothing to say, say nothing.

examples: []
anti_examples: []
cross_links: []
# A comment in a rule stays a comment.
`;

/** What {{rule:leave-it-better}} becomes: the body, as it is. */
export const RULE_BODY =
  '**Leave every file you touch in better shape than you found it.**\n\nTidy what is cheap and safe to tidy while you are there: dead code, unused imports, a value written twice, a weak name.\n\n**Say it:** "Left better: [what] in [file]". Nothing to say, say nothing.';

/** A one-line rule. */
export const SHORT_RULE = 'name: cite-it\nseverity: MUST\nbody: Cite a file and line for every claim.\n';
