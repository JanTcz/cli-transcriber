# The cli-transcriber plugin

One folder for every coding agent:

- `skills/cli-transcriber/SKILL.md` (Agent Skills standard): edit the YAML
  sources, not the generated files; build and check after every change. The
  agent runs the CLI in its shell (`npx -y cli-transcriber@0`).
- `claude/` (Claude Code only): a PreToolUse hook that blocks an edit to a file
  cli-transcriber generated and names its source.

| Agent | Manifest | Install |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` (skill and hook) | `/plugin marketplace add JanTcz/marketplace`, then `/plugin install cli-transcriber@jantcz` |
| Codex | `.codex-plugin/plugin.json` (skill) | `codex plugin marketplace add JanTcz/marketplace`, then enable `cli-transcriber@jantcz` |
| Others | none | copy `skills/cli-transcriber/` into the agent's skills folder |
