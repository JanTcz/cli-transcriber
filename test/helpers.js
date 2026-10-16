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
