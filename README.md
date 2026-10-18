<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="cli-transcriber" height="56">
  </picture>
</h1>

[![test](https://github.com/JanTcz/cli-transcriber/actions/workflows/test.yml/badge.svg)](https://github.com/JanTcz/cli-transcriber/actions/workflows/test.yml)
[![coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/JanTcz/cli-transcriber/actions/workflows/test.yml "Lines, branches and functions of src/; npm test fails below 100 %")
[![npm](https://img.shields.io/npm/v/cli-transcriber)](https://www.npmjs.com/package/cli-transcriber)
[![Socket Badge](https://socket.dev/api/badge/npm/package/cli-transcriber)](https://socket.dev/npm/package/cli-transcriber)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Write agent skills and subagents once, as YAML with shared partials, and
get the Markdown your agents read.** The text several skills share lives in
one partial; change it there and every skill that uses it changes with it.
And the language holds you to it: every partial, skill, agent and tool a
source uses must exist and be declared, every declared one must be used, and
the build says where it isn't.

```yaml
# skills/review.skill.yaml
name: review
description: Review a change before it is merged. Use when asked to review a diff or a pull request.
imports:
  partials: [report]
  agents: [security-check]
frontmatter:
  allowed-tools: Read, Grep, Bash(git diff:*)
body: |
  # Review

  1. Read the whole diff before commenting.
  2. For anything touching auth, input parsing or secrets, hand it to {{agent:security-check}}.

  {{partial:report title="Review"}}
```

```yaml
# partials/report.partial.yaml, used by review and incident
name: report
imports:
  partials: [evidence]
params:
  - name: title
body: |
  ## {{title}}

  List the findings, most serious first, one line each, then the details.

  {{partial:evidence what="finding"}}
```

`cli-transcriber build` turns them into `.claude/skills/review/SKILL.md` (and
`.claude/agents/…`, `.agents/skills/…` for Codex, or a plugin folder):
[the whole example](examples/team), sources and output.

When something is off, nothing is written and every problem is listed at once
(four typos in the example above):

```
partials/report.partial.yaml:6  error  parameter "title" is never used in the body
partials/report.partial.yaml:9  error  {{titel}} is not a parameter of this partial (did you mean "title"?); declare it under params, or write \{{ for a literal {{
skills/incident.skill.yaml:4  error  imports partial "evidense", which doesn't exist (did you mean "evidence"?)
skills/incident.skill.yaml:11  error  partial "report" needs parameter "title"
skills/incident.skill.yaml:15  error  uses partial "evidence" without importing it: add it to imports.partials
skills/review.skill.yaml:7  error  unknown tool "Gerp" (did you mean "Grep"?); if it is yours, add it to tools in transcriber.yaml
✖ 6 errors; nothing written
```

- **One place for shared text.** Partials with parameters and defaults,
  partials inside partials; a multi-line partial keeps the indentation of
  where it's used, so it works inside a list.
- **Rules from a shared corpus, unconverted.** A [`*.rule.yaml`](#rules) is
  a source as it is; `{{rule:…}}` puts its text into a skill.
- **References that can't dangle.** `{{partial:…}}`, `{{rule:…}}`, `{{skill:…}}` and
  `{{agent:…}}` must name something that exists and is listed under
  `imports`; an import that isn't used, a parameter nobody passes or nobody
  reads, a loop of partials, an unknown tool name: all errors, with the file,
  the line and a suggestion.
- **Generated files you can trust.** Each one says it is generated and from
  which source. `check` fails in CI when one was edited by hand or is out of
  date; `build` removes outputs whose source is gone and never overwrites a
  file it didn't write.
- **A plugin for Claude Code and Codex**: a skill that keeps the agent editing
  the sources, and (in Claude Code) a hook that stops an edit to a generated
  file and names its source.
- Node 20+, one dependency ([`yaml`](https://www.npmjs.com/package/yaml)).

## Getting started

```bash
npx cli-transcriber init      # transcriber.yaml, an example skill and partial
npx cli-transcriber build     # check everything, then write .claude/skills/…
npx cli-transcriber check     # in CI: sources valid, outputs up to date
```

Commit the sources and the generated files: the agent reads the files, the
sources are where they're edited.

### The plugin

Claude Code:

```
/plugin marketplace add JanTcz/marketplace
/plugin install cli-transcriber@jantcz
```

Codex: `codex plugin marketplace add JanTcz/marketplace`, then enable
`cli-transcriber@jantcz`. The skill is plain [Agent Skills](https://agentskills.io)
Markdown ([`agents/skills/cli-transcriber/`](agents/skills/cli-transcriber/SKILL.md))
for any other agent. The hook that blocks edits to generated files is Claude
Code's; elsewhere the skill and the header in each file carry the message.

## The language

A source is a YAML file named after what it defines: `review.skill.yaml`,
`security-check.agent.yaml`, `report.partial.yaml`, `leave-it-better.rule.yaml`.
Anywhere under the folders in `sources`. Skills and agents are written out;
partials and rules only go into them.

### Skills and agents

| Field | |
|---|---|
| `name` | Required. Lowercase letters, digits, `.`, `_`, `-`; the same as the file name |
| `description` | Required, at most 1024 characters: agents read it to decide when to use the skill |
| `imports` | `partials`, `rules`, `skills`, `agents`: lists of names. Everything the body uses, nothing it doesn't |
| `frontmatter` | More frontmatter, as is: `allowed-tools`, `model`, `tools`, `argument-hint`… (not `name` or `description`) |
| `body` | The text, with markers |
| `prose_blocks` | Instead of `body`: `[{ placement, body }]`. Placements ending in `-intro` come first, `-outro` last, the rest in order |
| `metadata` | Anything of your own; not written out |

Fields starting with `$` are ignored; any other field is an error, so a typo
in a field name doesn't go unnoticed.

### Partials

| Field | |
|---|---|
| `name` | Required, the same as the file name |
| `description` | What it is for |
| `imports` | The partials, rules, skills and agents its body uses |
| `params` | `[{ name, description, default }]` or a map `{ name: { description, default } }`. Required unless it has a `default` |
| `body` | Required. `{{param}}` is replaced by the value |

### Markers

| Marker | Becomes |
|---|---|
| `{{partial:report title="Review" tone=plain}}` | The partial's body with its parameters filled in. Values in `"…"`, `'…'` or bare |
| `{{rule:leave-it-better}}` | The rule's body, exactly as it is in the rule. No parameters |
| `{{skill:review}}`, `{{agent:security-check}}` | The name, checked to exist |
| `\{{` | A literal `{{` |

`${{ … }}` (GitHub Actions) and `{{ a.b }}` are left alone. A parameter value
is text: braces in it stay braces.

### Rules

A rule is a `*.rule.yaml` in the format of the framework cli-transcriber
comes from ([Origin](#origin)), read as it is: point `sources` at a folder of
such rules and import them by name, without converting them.

| Field | |
|---|---|
| `name` | Required, the same as the file name |
| `body` | Required. The rule's text, Markdown |
| `title`, `description`, `severity`, `scope` | Text. `severity` is meant as `MUST`, `SHOULD` or `MAY` and `scope` as `universal`, `project` or `stack`, but any text is accepted |
| `version` | Text or a number |
| `status`, `owner`, `reflex`, `discipline`, `layer`, `removal_predicate`, `enforcement_status`, `enforcement_rationale` | Text |
| `deprecated` | Text or `null` |
| `subagent_reflex` | `true` or `false` |
| `examples`, `anti_examples`, `cross_links` | Lists |
| `enforced_by` | A name, a list of names, or `null` |
| `metadata` | Anything of your own |

None of these is written out except `body`. Fields starting with `$`
(`$kind`, `$schema`…) are ignored, as everywhere; any other field is an
error. A rule has no `imports` and no parameters: its body is text, not a
template, so nothing in it is a marker and its `{{` stay `{{`.

`{{rule:NAME}}` becomes the body and nothing else: no heading, no severity.
Put the heading in the skill, where you know its level. A rule of several
lines stands alone on its line and keeps that line's indentation, like a
partial. Skills, agents and partials import rules under `imports.rules`:

```yaml
# skills/refactor.skill.yaml; rules/ holds preserve-existing-behavior.rule.yaml
# and code-quality-leave-it-better.rule.yaml, copied from the framework as they are
name: refactor
description: Change existing code without changing what it does. Use when asked to clean up, restructure or simplify code.
imports:
  rules: [preserve-existing-behavior, code-quality-leave-it-better]
  skills: [review]
body: |
  # Refactor

  Run the tests before the first edit and after the last; they pass both times.

  ## Rules

  {{rule:preserve-existing-behavior}}

  {{rule:code-quality-leave-it-better}}

  Then hand the diff to {{skill:review}}.
```

[Its output](examples/team/.claude/skills/refactor/SKILL.md). `show rule:NAME`
prints a rule as its marker puts it. A rule nobody imports is not a warning:
a corpus of rules is shared, and most of it is unused in any one project.

### What the build checks

- the YAML parses, required fields are there, every field is known and of the right type, names match file names
- every marker names a partial, rule, skill or agent that exists, and the source imports it
- every import exists and is used
- a partial call gives every required parameter and no unknown one; a partial reads every parameter it declares and no other
- a partial or a rule with several lines stands alone on its line
- partials don't include each other in a loop (rules include nothing)
- a name is defined once per kind
- `allowed-tools` (skills) and `tools` (agents) name real tools: Claude Code's, `mcp__server__tool`, or yours from `transcriber.yaml`
- a partial nobody uses is a warning; everything else is an error

## Configuration

`transcriber.yaml` in the project root, all optional:

```yaml
sources: [skills, agents, partials, rules]   # default: the whole project
targets: [claude, codex, "plugin:dist"]
tools: [MyDeployTool]
```

| Target | Skills | Agents |
|---|---|---|
| `claude` (default) | `.claude/skills/<name>/SKILL.md` | `.claude/agents/<name>.md` |
| `codex` | `.agents/skills/<name>/SKILL.md` | not written: Codex subagents aren't Markdown |
| `plugin:<folder>` | `<folder>/skills/<name>/SKILL.md` | `<folder>/agents/<name>.md` |

## CLI

| Command | |
|---|---|
| `build` | Check every source, then write the outputs and remove stale ones. `--force` overwrites files at output paths it didn't write |
| `check` | Check every source and that every output exists and matches; writes nothing. For CI and pre-commit |
| `show NAME` | One skill or agent as it would be written, or a rule as `{{rule:NAME}}` puts it (`skill:NAME`, `agent:NAME` or `rule:NAME` when several share the name) |
| `init` | `transcriber.yaml` and an example; never overwrites |

`--root=dir` for a project elsewhere; JSON when stdout isn't a terminal (or
with `--json`), text otherwise (or with `--text`). Exit codes: `0` fine, `1`
problems in the sources or outdated outputs, `2` bad arguments or config.

In GitHub Actions:

```yaml
- run: npx -y cli-transcriber@0 check
```

## As a library

```js
import { compile, build, check } from 'cli-transcriber';

const { problems, outputs } = compile('.');   // outputs: Map of path → Markdown, null on errors
```

Types are in `src/index.d.ts`.

## This repository

```
src/load.js        finding and reading sources, the shape of each kind
src/language.js    markers, the checks between sources, rendering
src/project.js     config, targets, build, check, show
src/cli.js         the command
agents/            the plugin: the skill, the Claude Code hook, the manifests
examples/team/     three skills, an agent, two partials and two rules, with their output
```

```bash
npm test     # fails below 100 % lines, branches or functions; checks examples/ too
```

### Releasing

Bump `version` in `package.json` and both `agents/*/plugin.json`, then push a
tag `v<version>`. `.github/workflows/release.yml` checks that the tag and the
three versions match, runs the tests and publishes to npm with provenance
(Trusted Publishing, no token in the repository).

## Origin

cli-transcriber is the template part of the "agent language" of a larger
agent framework, where a few hundred skills, agents and rules share partials.
It keeps that framework's marker syntax and closes what it left open there:
parameters are checked, imports are checked both ways, every check runs in one
place before anything is written, and a changed partial or rule can't leave a stale
skill behind.

## License

[MIT](LICENSE) © 2026 Jan Truhlar
