export type Kind = 'skill' | 'agent' | 'partial' | 'rule';

export const KINDS: readonly Kind[];
export const CONFIG: string;
export const VERSION: string;
export const KNOWN_TOOLS: readonly string[];

export interface Problem {
  level: 'error' | 'warning';
  /** Relative to the project root. */
  file: string;
  line: number;
  message: string;
}

export interface Config {
  /** Folders searched for *.skill.yaml, *.agent.yaml, *.partial.yaml, *.rule.yaml. */
  sources: string[];
  /** claude, codex, plugin:<folder> */
  targets: string[];
  /** Tool names of your own, besides Claude Code's and mcp__*. */
  tools: string[];
}

export interface Compiled {
  config: Config;
  problems: Problem[];
  /** Output path (relative) → content; null when a source has an error. */
  outputs: Map<string, string> | null;
}

export function readConfig(root: string): Config;
export function targetDirs(target: string): { skills: string; agents: string | null } | null;
export function compile(root: string): Compiled;

export function build(root: string, opts?: { force?: boolean }): {
  op: 'build';
  ok: boolean;
  problems: Problem[];
  written?: string[];
  removed?: string[];
  unchanged?: number;
};
export function check(root: string): { op: 'check'; ok: boolean; problems: Problem[]; outdated: { path: string; why: string }[] };
export function show(root: string, name: string): { op: 'show'; ok: boolean; problems: Problem[]; kind?: 'skill' | 'agent' | 'rule'; name?: string; source?: string; content?: string };
export function init(root: string): { op: 'init'; ok: true; problems: []; created: string[] };

export function discover(root: string, sources: string[], skip?: string[]): string[];
export function load(root: string, file: string): { doc: object | null; problems: Problem[] };
export function validate(docs: object[], registry: object, opts?: { tools?: string[] }): Problem[];
export function render(doc: object, registry: object): string;
export function renderBody(doc: object, registry: object): string;
export function expandText(text: string, registry: object): string;

/** Runs the CLI; resolves to the exit code. */
export function main(args: string[], io?: object): Promise<number>;
