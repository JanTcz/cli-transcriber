// The language: markers, the checks that everything a source uses exists and is
// declared, and the rendering of skills and agents to Markdown.
//
//   {{partial:NAME key="value" key2=bare}}   the partial's body, its {{key}}s filled in
//   {{skill:NAME}} {{agent:NAME}}            the name, checked to exist
//   {{rule:NAME}}                            the rule's body, as it is
//   \{{                                      a literal {{

import { problem } from './load.js';

const MARKER_KINDS = { partial: 'partials', skill: 'skills', agent: 'agents', rule: 'rules' };
const MARKER = /(\\?)\{\{\s*([a-z]+):([^\s}]+)((?:\s+[^\s=}]+=(?:"[^"]*"|'[^']*'|[^\s"'}]+))*)\s*\}\}/g;
const ARG = /([^\s=}]+)=(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/g;
const LOOSE = /(?<!\\)\{\{\s*[a-z]+:/g;
const PLACEHOLDER = /(\\?)(\$?)\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

/** Markers on one line: { raw, escaped, kind, name, args, start, end }. */
export function markersIn(line) {
  const out = [];
  for (const m of line.matchAll(MARKER)) {
    const args = {};
    for (const a of m[4].matchAll(ARG)) args[a[1]] = a[2] ?? a[3] ?? a[4];
    out.push({ raw: m[0], escaped: m[1] === '\\', kind: m[2], name: m[3], args, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** `{{word:` that no marker accounts for: an unclosed or garbled marker. */
export function looseMarkers(line) {
  const covered = markersIn(line);
  return [...line.matchAll(LOOSE)].filter((m) => !covered.some((c) => m.index >= c.start && m.index < c.end)).map((m) => m.index);
}

/** {{param}} placeholders in a partial: not escaped, not GitHub's ${{ }}. */
export function placeholdersIn(line) {
  return [...line.matchAll(PLACEHOLDER)].filter((m) => !m[1] && !m[2]).map((m) => ({ name: m[3], raw: m[0], start: m.index }));
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** " (did you mean x?)" when a known name is close enough. */
export function suggest(name, known) {
  const best = [...known].map((k) => [k, distance(name, k)]).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= Math.max(2, Math.floor(name.length / 3)) ? ` (did you mean "${best[0]}"?)` : '';
}

/** Each line of each block with where it is: { text, line, block }. */
function* lines(doc) {
  for (const block of doc.blocks) {
    const split = block.text.split('\n');
    for (let i = 0; i < split.length; i++) yield { text: split[i], line: doc.textLine(block.at, i), block };
  }
}

const multiline = (text) => text.replace(/\n+$/, '').includes('\n');

/**
 * Checks every source against the others. `registry` is { skill, agent, partial, rule }: Maps
 * of name → doc. Returns problems; adds nothing to the docs.
 */
export function validate(docs, registry, { tools = [] } = {}) {
  const problems = [];
  const usedPartials = new Set();
  const edges = new Map();
  for (const doc of docs) {
    // A rule is text, not a template: nothing in it is a marker, it imports nothing.
    if (doc.kind === 'rule') continue;
    const used = { partials: new Set(), skills: new Set(), agents: new Set(), rules: new Set() };
    for (const { text, line } of lines(doc)) {
      for (const at of looseMarkers(text)) problems.push(problem(doc.file, line, `a marker that doesn't parse: ${text.slice(at, at + 40).trim()}…`));
      for (const m of markersIn(text)) {
        if (m.escaped) continue;
        const list = MARKER_KINDS[m.kind];
        if (!list) {
          problems.push(problem(doc.file, line, `unknown marker {{${m.kind}:…}}; markers are partial, skill, agent and rule${suggest(m.kind, Object.keys(MARKER_KINDS))}`));
          continue;
        }
        used[list].add(m.name);
        const target = registry[m.kind].get(m.name);
        if (!target) {
          problems.push(problem(doc.file, line, `${m.kind} "${m.name}" doesn't exist${suggest(m.name, registry[m.kind].keys())}`));
          continue;
        }
        if (!doc.imports[list].some((i) => i.name === m.name)) problems.push(problem(doc.file, line, `uses ${m.kind} "${m.name}" without importing it: add it to imports.${list}`));
        if ((m.kind === 'partial' || m.kind === 'rule') && multiline(target.blocks[0].text) && text.trim() !== m.raw) {
          problems.push(problem(doc.file, line, `${m.kind} "${m.name}" has several lines, so its marker must be alone on its line`));
        }
        if (m.kind !== 'partial') {
          if (Object.keys(m.args).length) problems.push(problem(doc.file, line, `{{${m.kind}:…}} takes no parameters`));
          continue;
        }
        usedPartials.add(m.name);
        if (doc.kind === 'partial') edges.set(doc.name, [...(edges.get(doc.name) ?? []), m.name]);
        for (const key of Object.keys(m.args)) {
          if (!target.params.some((p) => p.name === key)) problems.push(problem(doc.file, line, `partial "${m.name}" has no parameter "${key}"${suggest(key, target.params.map((p) => p.name))}`));
        }
        for (const p of target.params) {
          if (!p.hasDefault && !(p.name in m.args)) problems.push(problem(doc.file, line, `partial "${m.name}" needs parameter "${p.name}"`));
        }
      }
    }
    for (const [list, entries] of Object.entries(doc.imports)) {
      const kind = list.slice(0, -1);
      const seen = new Set();
      for (const { name, line } of entries) {
        if (seen.has(name)) problems.push(problem(doc.file, line, `imports.${list} lists "${name}" twice`));
        seen.add(name);
        if (!registry[kind].has(name)) problems.push(problem(doc.file, line, `imports ${kind} "${name}", which doesn't exist${suggest(name, registry[kind].keys())}`));
        else if (!used[list].has(name)) problems.push(problem(doc.file, line, `imports ${kind} "${name}" but never uses it: add {{${kind}:${name}}} or remove the import`));
      }
    }
    if (doc.kind === 'partial') {
      const placed = new Set();
      for (const { text, line } of lines(doc)) {
        for (const ph of placeholdersIn(text)) {
          placed.add(ph.name);
          if (!doc.params.some((p) => p.name === ph.name)) problems.push(problem(doc.file, line, `{{${ph.name}}} is not a parameter of this partial${suggest(ph.name, doc.params.map((p) => p.name))}; declare it under params, or write \\{{ for a literal {{`));
        }
      }
      for (const p of doc.params) if (!placed.has(p.name)) problems.push(problem(doc.file, p.line, `parameter "${p.name}" is never used in the body`));
    } else {
      problems.push(...checkTools(doc, tools));
    }
  }
  problems.push(...cycles(edges, registry));
  for (const p of registry.partial.values()) {
    if (!usedPartials.has(p.name)) problems.push(problem(p.file, p.lineOf(['name']), `partial "${p.name}" is not used anywhere`, 'warning'));
  }
  return problems;
}

/** Partials that include themselves, directly or through others. */
function cycles(edges, registry) {
  const problems = [];
  const done = new Set();
  const visit = (name, stack) => {
    if (stack.includes(name)) {
      const loop = [...stack.slice(stack.indexOf(name)), name];
      const p = registry.partial.get(name);
      problems.push(problem(p.file, p.lineOf(['body']), `partials include each other in a loop: ${loop.join(' → ')}`));
      return;
    }
    if (done.has(name)) return;
    for (const next of edges.get(name) ?? []) visit(next, [...stack, name]);
    done.add(name);
  };
  for (const name of [...edges.keys()].sort()) visit(name, []);
  return problems;
}

/** Claude Code's own tools; MCP tools are mcp__server__tool; more come from the config. */
export const KNOWN_TOOLS = [
  'Agent', 'AskUserQuestion', 'Bash', 'BashOutput', 'Edit', 'EnterPlanMode', 'EnterWorktree', 'ExitPlanMode', 'ExitWorktree',
  'Glob', 'Grep', 'KillShell', 'LS', 'ListMcpResourcesTool', 'Monitor', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Read',
  'ReadMcpResourceTool', 'SendMessage', 'Skill', 'SlashCommand', 'Task', 'TodoWrite', 'ToolSearch', 'WebFetch', 'WebSearch', 'Write',
];

function toolList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(/[,\s]+(?![^(]*\))/).filter(Boolean);
  return [];
}

function checkTools(doc, extra) {
  const fm = doc.data.frontmatter ?? {};
  const key = doc.kind === 'agent' ? 'tools' : 'allowed-tools';
  if (!(key in fm)) return [];
  const known = new Set([...KNOWN_TOOLS, ...extra]);
  const out = [];
  for (const tool of toolList(fm[key])) {
    const base = tool.replace(/\(.*\)$/, '');
    if (known.has(base) || /^mcp__[\w-]+(__[\w-]+)?$/.test(base)) continue;
    out.push(problem(doc.file, doc.lineOf(['frontmatter', key]), `unknown tool "${base}"${suggest(base, known)}; if it is yours, add it to tools in transcriber.yaml`));
  }
  return out;
}

// ─── rendering (of validated sources) ──────────────────────────────────────────

/** The partial's body with its parameters filled in, and its own markers expanded. */
function expandPartial(partial, args, registry) {
  // A value is text: braces in it stay braces, they are not markers.
  const values = Object.fromEntries(partial.params.map((p) => [p.name, (p.name in args ? args[p.name] : p.default).replace(/\{\{/g, '\\{{')]));
  const filled = partial.blocks[0].text
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => line.replace(PLACEHOLDER, (raw, esc, dollar, name) => (esc || dollar ? raw : values[name])))
    .join('\n');
  return expand(filled, registry);
}

/** What {{rule:NAME}} becomes: the rule's body as it is, without its trailing newlines. */
export function ruleText(rule) {
  return rule.blocks[0].text.replace(/\n+$/, '');
}

// A rule's {{ stand for themselves at any depth: held out of the unescaping of \{{ (each partial
// level does it once) until the end. YAML text can't hold this character, so no source has it.
const HELD = '\u0000';

/** The text one marker stands for. */
function insert(m, registry) {
  if (m.kind === 'partial') return expandPartial(registry.partial.get(m.name), m.args, registry);
  if (m.kind === 'rule') return ruleText(registry.rule.get(m.name)).replaceAll('{{', HELD);
  return m.name;
}

/** Markers replaced; a multi-line partial or rule keeps the indentation of its marker. */
function expand(text, registry) {
  return text
    .split('\n')
    .map((line) => {
      const markers = markersIn(line).filter((m) => !m.escaped);
      if (markers.length === 1 && markers[0].kind !== 'skill' && markers[0].kind !== 'agent' && line.trim() === markers[0].raw) {
        const indent = /^\s*/.exec(line)[0];
        return insert(markers[0], registry)
          .split('\n')
          .map((l) => (l ? indent + l : l))
          .join('\n');
      }
      let out = '';
      let at = 0;
      for (const m of markers) {
        out += line.slice(at, m.start) + insert(m, registry);
        at = m.end;
      }
      return out + line.slice(at);
    })
    .join('\n')
    .replace(/\\\{\{/g, '{{');
}

/** Markers in a text replaced, `\{{` written as `{{`. */
export function expandText(text, registry) {
  return expand(text, registry).replaceAll(HELD, '{{');
}

/** The body of a skill or agent: its blocks, expanded, one after another. */
export function renderBody(doc, registry) {
  return doc.blocks.map((b) => expandText(b.text.replace(/\s+$/, ''), registry)).join('\n\n');
}
