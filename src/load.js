// Finds the sources and reads them: YAML parsed with positions, so every problem can
// be reported as file:line, and checked against the shape of its kind.

import fs from 'node:fs';
import path from 'node:path';
import { LineCounter, isScalar, parseDocument } from 'yaml';

export const KINDS = ['skill', 'agent', 'partial', 'rule'];
const SUFFIX = /\.(skill|agent|partial|rule)\.ya?ml$/;
const SKIP = new Set(['node_modules', '.git']);
export const NAME = /^[a-z0-9][a-z0-9._-]*$/;

/** A problem in a source: errors stop the build, warnings don't. */
export function problem(file, line, message, level = 'error') {
  return { level, file, line, message };
}

/** Every source file under the given folders, relative to root, sorted. */
export function discover(root, sources, skip = []) {
  const skipAbs = new Set(skip.map((d) => path.resolve(root, d)));
  const found = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !skipAbs.has(full)) walk(full);
      } else if (SUFFIX.test(e.name)) found.add(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  for (const s of sources) walk(path.resolve(root, s));
  return [...found].sort();
}

// ─── shapes ────────────────────────────────────────────────────────────────────

const string = (v) => typeof v === 'string';
const map = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => Array.isArray(v);

const IMPORTS = ['partials', 'skills', 'agents', 'rules'];
const an = (kind) => (kind === 'agent' ? 'an agent' : `a ${kind}`);

const COMMON = {
  name: { required: true, ok: string, type: 'a string' },
  description: { ok: string, type: 'a string' },
  imports: { ok: map, type: 'a map of partials, skills, agents, rules' },
  metadata: { ok: map, type: 'a map' },
};

export const SHAPES = {
  skill: {
    ...COMMON,
    description: { ...COMMON.description, required: true },
    frontmatter: { ok: map, type: 'a map' },
    body: { ok: string, type: 'text' },
    prose_blocks: { ok: list, type: 'a list of { placement, body }' },
  },
  agent: {
    ...COMMON,
    description: { ...COMMON.description, required: true },
    frontmatter: { ok: map, type: 'a map' },
    body: { ok: string, type: 'text' },
    prose_blocks: { ok: list, type: 'a list of { placement, body }' },
  },
  partial: {
    ...COMMON,
    params: { ok: (v) => list(v) || map(v), type: 'a list of { name, description, default } or a map' },
    body: { required: true, ok: string, type: 'text' },
  },
  // A rule in the format of the framework this comes from (README, Origin), read as it is: the
  // body is the text, the other fields are metadata. No imports: a rule is text, not a template.
  rule: {
    name: COMMON.name,
    body: { required: true, ok: string, type: 'text' },
    description: { ok: string, type: 'text' },
    title: { ok: string, type: 'text' },
    version: { ok: (v) => string(v) || typeof v === 'number', type: 'text or a number' },
    status: { ok: string, type: 'text' },
    owner: { ok: string, type: 'text' },
    deprecated: { ok: (v) => v === null || string(v), type: 'text or null' },
    scope: { ok: string, type: 'text' },
    severity: { ok: string, type: 'text' },
    reflex: { ok: string, type: 'text' },
    subagent_reflex: { ok: (v) => typeof v === 'boolean', type: 'true or false' },
    discipline: { ok: string, type: 'text' },
    layer: { ok: string, type: 'text' },
    examples: { ok: list, type: 'a list' },
    anti_examples: { ok: list, type: 'a list' },
    cross_links: { ok: list, type: 'a list' },
    removal_predicate: { ok: string, type: 'text' },
    enforced_by: { ok: (v) => v === null || string(v) || (list(v) && v.every(string)), type: 'a name, a list of names or null' },
    enforcement_status: { ok: string, type: 'text' },
    enforcement_rationale: { ok: string, type: 'text' },
    metadata: COMMON.metadata,
  },
};

/** Where a value is in the file: the line of the node at `at` (1-based). */
function locator(doc, lc) {
  const lineOf = (at) => {
    for (let i = at.length; i >= 0; i--) {
      const node = i === 0 ? doc.contents : doc.getIn(at.slice(0, i), true);
      if (node?.range) return lc.linePos(node.range[0]).line;
    }
    return 1;
  };
  /** The line of line `index` inside the text at `at` (block scalars start a line later). */
  const textLine = (at, index) => {
    const node = doc.getIn(at, true);
    const block = isScalar(node) && (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED');
    return lineOf(at) + (block ? 1 : 0) + index;
  };
  return { lineOf, textLine };
}

/** The params of a partial in one shape: [{ name, description, default?, line }]. */
function normalizeParams(raw, lineOf, file, problems) {
  const entries = Array.isArray(raw)
    ? raw.map((p, i) => [p, ['params', i]])
    : Object.entries(raw).map(([name, p]) => [{ ...(map(p) ? p : { default: p }), name }, ['params', name]]);
  const out = [];
  for (const [p, at] of entries) {
    if (!map(p) || !string(p.name) || !/^[A-Za-z_][\w-]*$/.test(p.name)) {
      problems.push(problem(file, lineOf(at), 'a parameter needs a name (letters, digits, _ and -)'));
      continue;
    }
    if ('default' in p && p.default !== null && typeof p.default === 'object') {
      problems.push(problem(file, lineOf(at), `the default of parameter "${p.name}" must be text, a number or a boolean`));
      continue;
    }
    out.push({ name: p.name, description: p.description ?? null, hasDefault: 'default' in p, default: p.default == null ? '' : String(p.default), line: lineOf(at) });
  }
  return out;
}

/**
 * Reads one source. Returns { doc, problems }: doc is null when the file can't be used.
 * doc: { kind, name, file, data, params, blocks: [{ text, at }], imports, lineOf, textLine }
 */
export function load(root, file) {
  const problems = [];
  const kind = SUFFIX.exec(file)[1];
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const lc = new LineCounter();
  const parsed = parseDocument(source, { lineCounter: lc, uniqueKeys: true, prettyErrors: false });
  if (parsed.errors.length) {
    for (const e of parsed.errors) problems.push(problem(file, lc.linePos(e.pos[0]).line, `YAML: ${e.message.split('\n')[0]}`));
    return { doc: null, problems };
  }
  const data = parsed.toJS() ?? {};
  const { lineOf, textLine } = locator(parsed, lc);
  if (!map(data)) return { doc: null, problems: [problem(file, 1, `${an(kind)} is a map of fields`)] };

  const shape = SHAPES[kind];
  for (const [key, rule] of Object.entries(shape)) {
    if (rule.required && !(key in data)) problems.push(problem(file, lineOf([]), `"${key}" is required`));
    else if (key in data && !rule.ok(data[key])) problems.push(problem(file, lineOf([key]), `"${key}" must be ${rule.type}`));
  }
  for (const key of Object.keys(data)) {
    if (key.startsWith('$')) continue;
    if (!(key in shape)) problems.push(problem(file, lineOf([key]), `unknown field "${key}" in ${an(kind)}; put your own fields under "metadata"`));
  }
  if ('$kind' in data && data.$kind !== kind) problems.push(problem(file, lineOf(['$kind']), `$kind is "${data.$kind}" but the file is a .${kind}.yaml`));

  const expected = path.basename(file).replace(SUFFIX, '');
  if (string(data.name)) {
    if (!NAME.test(data.name)) problems.push(problem(file, lineOf(['name']), `name "${data.name}" must be lowercase letters, digits, ".", "_" or "-"`));
    else if (data.name !== expected) problems.push(problem(file, lineOf(['name']), `name "${data.name}" must match the file name "${expected}"`));
  }
  const page = kind === 'skill' || kind === 'agent';
  if (string(data.description) && page) {
    if (!data.description.trim()) problems.push(problem(file, lineOf(['description']), 'description is empty'));
    if (data.description.length > 1024) problems.push(problem(file, lineOf(['description']), `description is ${data.description.length} characters; agents read at most 1024`));
  }

  const imports = { partials: [], skills: [], agents: [], rules: [] };
  if (map(data.imports)) {
    for (const [key, value] of Object.entries(data.imports)) {
      if (!IMPORTS.includes(key)) {
        problems.push(problem(file, lineOf(['imports', key]), `imports can list ${IMPORTS.join(', ')}; not "${key}"`));
      } else if (!list(value) || !value.every(string)) {
        problems.push(problem(file, lineOf(['imports', key]), `imports.${key} must be a list of names`));
      } else {
        imports[key] = value.map((name, i) => ({ name, line: lineOf(['imports', key, i]) }));
      }
    }
  }

  let blocks = [];
  if (page) {
    const has = ['body', 'prose_blocks'].filter((k) => k in data);
    if (has.length !== 1) problems.push(problem(file, 1, `${an(kind)} needs "body" or "prose_blocks" (one of them)`));
    if (string(data.body)) blocks = [{ text: data.body, at: ['body'] }];
    if (list(data.prose_blocks)) {
      const ordered = data.prose_blocks
        .map((b, i) => ({ b, at: ['prose_blocks', i, 'body'], i }))
        .filter(({ b, at }) => {
          if (map(b) && string(b.body) && (b.placement === undefined || string(b.placement))) return true;
          problems.push(problem(file, lineOf(at.slice(0, 2)), 'a prose block is { placement, body } with text in body'));
          return false;
        });
      // Intros first and outros last, whatever their order in the file; the rest as written.
      const rank = ({ b }) => (/-intro$/.test(b.placement ?? '') ? 0 : /-outro$/.test(b.placement ?? '') ? 2 : 1);
      blocks = ordered.sort((x, y) => rank(x) - rank(y) || x.i - y.i).map(({ b, at }) => ({ text: b.body, at }));
    }
    for (const key of ['name', 'description']) {
      if (map(data.frontmatter) && key in data.frontmatter) problems.push(problem(file, lineOf(['frontmatter', key]), `frontmatter.${key} comes from the top-level "${key}"; remove it here`));
    }
  } else if (string(data.body)) {
    blocks = [{ text: data.body, at: ['body'] }];
  }

  const params = kind === 'partial' && (list(data.params) || map(data.params)) ? normalizeParams(data.params, lineOf, file, problems) : [];
  const doc = { kind, name: data.name, file, data, params, blocks, imports, lineOf, textLine };
  return { doc: problems.some((p) => p.level === 'error') ? null : doc, problems };
}
