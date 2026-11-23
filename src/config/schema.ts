import {
  CAMEL_HOOKS,
  HOOKS,
  type HookName,
  resolveHookName,
} from "../hooks/list.ts";
import { DEFAULT_FILE_SOURCE, fileSources } from "../runner/command.ts";
import { checkGlob } from "../runner/match.ts";
import type { Config, HookConfig, TaskFunction } from "./define.ts";
import { ConfigError } from "./errors.ts";

/**
 * Internal model every config form is normalized to. Fields are added with
 * the features that use them (`glob`, `parallel`, `backup`, ...).
 */
export type Task = {
  /** Key in `{ tasks }`; for the string and array forms, the command itself. */
  readonly name: string;
  /** Shell command, or a function (TS config only). */
  readonly run: string | TaskFunction;
  /** Files the task runs on; all files when absent. */
  readonly glob?: readonly string[];
  /** Files dropped even when `glob` matches them. */
  readonly exclude?: readonly string[];
  /** Include symlinks in the task's files; left out when absent. */
  readonly symlinks?: boolean;
  /** `false`: leave files the task changed unstaged; staged when absent. */
  readonly stageFixed?: boolean;
};

export type Hook = {
  /** In config order. */
  readonly tasks: readonly Task[];
  /** Run the tasks at once; one after another when absent. */
  readonly parallel?: boolean;
  /** `false`: no `git stash create` backup before the run; on when absent. */
  readonly backup?: boolean;
  /** `false`: keep task changes when the hook fails; reverted when absent. */
  readonly revert?: boolean;
};

export type ResolvedConfig = {
  readonly hooks: Readonly<Partial<Record<HookName, Hook>>>;
};

/**
 * Options from the README that later versions add: named in the error
 * instead of "unknown option", since users will copy them from the docs.
 */
const PLANNED = {
  config: ["extends"],
  hook: [],
  task: ["root", "tags", "cache", "dependsOn"],
} as const;

/** Options each level accepts; `json-schema.ts` must list the same. */
export const KNOWN = {
  config: ["hooks"],
  hook: ["tasks", "parallel", "backup", "revert"],
  task: ["run", "glob", "exclude", "symlinks", "stageFixed"],
} as const;

/**
 * Check a loaded config (any format) and return it typed. Collects every
 * problem, so one run shows them all.
 *
 * @param name Config name for the message: `ward.yml`, `package.json "ward"`.
 * @throws ConfigError listing each problem with its path in the config.
 */
export function validateConfig(raw: unknown, name: string): Config {
  const issues: string[] = [];
  const report = (path: string, message: string) =>
    issues.push(path ? `${path}: ${message}` : message);

  checkConfig(raw, report);

  if (issues.length > 0) {
    throw new ConfigError(
      `${name} is invalid:\n${issues.map((issue) => `  ${issue}`).join("\n")}`,
    );
  }
  return raw as Config;
}

type Report = (path: string, message: string) => void;

function checkConfig(raw: unknown, report: Report): void {
  if (!isObject(raw)) {
    report("", `expected an object with \`hooks\`, got ${describe(raw)}`);
    return;
  }

  for (const key of Object.keys(raw)) {
    if (key === "hooks") continue;
    if (resolveHookName(key)) {
      report(key, "hooks go under `hooks:`, e.g. `hooks: { " + key + ": … }`");
    } else {
      report(key, unknownOption(key, "config"));
    }
  }

  if (!Object.hasOwn(raw, "hooks")) return;
  const hooks = raw.hooks;
  if (!isObject(hooks)) {
    report("hooks", `expected an object of hooks, got ${describe(hooks)}`);
    return;
  }
  const seen = new Map<HookName, string>();
  for (const [key, value] of Object.entries(hooks)) {
    const path = join("hooks", key);
    const hook = resolveHookName(key);
    if (!hook) {
      // Suggest in the spelling the key is written in.
      const camel = /[A-Z]/.test(key) && !key.includes("-");
      report(path, `unknown hook${suggest(key, camel ? CAMEL_HOOKS : HOOKS)}`);
      continue;
    }
    const other = seen.get(hook);
    if (other !== undefined) {
      report(path, `the same hook as "${other}": keep one of them`);
      continue;
    }
    seen.set(hook, key);
    checkHook(value, hook, path, report);
  }
}

function checkHook(
  value: unknown,
  hook: HookName,
  path: string,
  report: Report,
): void {
  if (typeof value === "string") {
    checkCommand(value, hook, path, report);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((command: unknown, i) => {
      checkCommand(command, hook, `${path}[${String(i)}]`, report);
    });
    return;
  }
  if (!isObject(value)) {
    report(
      path,
      `expected a command, a list of commands or \`{ tasks }\`, got ${describe(value)}`,
    );
    return;
  }

  for (const key of Object.keys(value)) {
    if (!(KNOWN.hook as readonly string[]).includes(key)) {
      report(join(path, key), unknownOption(key, "hook"));
    }
  }
  for (const key of ["parallel", "backup", "revert"] as const) {
    if (Object.hasOwn(value, key) && typeof value[key] !== "boolean") {
      report(
        join(path, key),
        `expected true or false, got ${describe(value[key])}`,
      );
    }
  }
  if (!Object.hasOwn(value, "tasks")) {
    report(path, "missing `tasks`");
    return;
  }
  const tasks = value.tasks;
  const tasksPath = join(path, "tasks");
  if (!isObject(tasks)) {
    report(
      tasksPath,
      `expected an object of named tasks, got ${describe(tasks)}`,
    );
    return;
  }
  for (const [name, task] of Object.entries(tasks)) {
    const taskPath = join(tasksPath, name);
    if (name.trim() === "") report(taskPath, "task name is empty");
    checkTask(task, hook, taskPath, report);
  }
}

function checkTask(
  task: unknown,
  hook: HookName,
  path: string,
  report: Report,
): void {
  if (!isObject(task)) {
    report(path, `expected \`{ run: "…" }\`, got ${describe(task)}`);
    return;
  }
  for (const key of Object.keys(task)) {
    if (!(KNOWN.task as readonly string[]).includes(key)) {
      report(join(path, key), unknownOption(key, "task"));
    }
  }
  for (const key of ["glob", "exclude"] as const) {
    if (Object.hasOwn(task, key)) {
      checkPatterns(task[key], join(path, key), report);
    }
  }
  for (const key of ["symlinks", "stageFixed"] as const) {
    if (Object.hasOwn(task, key) && typeof task[key] !== "boolean") {
      report(
        join(path, key),
        `expected true or false, got ${describe(task[key])}`,
      );
    }
  }
  if (!Object.hasOwn(task, "run")) {
    report(path, "missing `run`");
    return;
  }
  const filtered =
    Object.hasOwn(task, "glob") || Object.hasOwn(task, "exclude");
  // Without files to match the patterns against, they would do nothing.
  const noFiles = DEFAULT_FILE_SOURCE[hook] === undefined;
  if (typeof task.run === "function") {
    if (filtered && noFiles) {
      report(
        path,
        "`glob` and `exclude` on a function task only work in `pre-commit` and `pre-push`",
      );
    }
    return;
  }
  checkCommand(task.run, hook, join(path, "run"), report);

  if (
    filtered &&
    noFiles &&
    typeof task.run === "string" &&
    fileSources(task.run).size === 0
  ) {
    report(
      path,
      "`glob` and `exclude` need `{staged_files}`, `{push_files}` or `{all_files}` in `run` outside `pre-commit` and `pre-push`",
    );
  }
}

/** `glob` / `exclude`: one pattern or a non-empty list of them. */
function checkPatterns(value: unknown, path: string, report: Report): void {
  if (typeof value === "string") {
    checkPattern(value, path, report);
    return;
  }
  if (!Array.isArray(value)) {
    report(
      path,
      `expected a pattern or a list of patterns, got ${describe(value)}`,
    );
    return;
  }
  if (value.length === 0) {
    report(path, "list of patterns is empty");
    return;
  }
  value.forEach((pattern: unknown, i) => {
    const itemPath = `${path}[${String(i)}]`;
    if (typeof pattern !== "string") {
      report(itemPath, `expected a pattern string, got ${describe(pattern)}`);
    } else {
      checkPattern(pattern, itemPath, report);
    }
  });
}

function checkPattern(pattern: string, path: string, report: Report): void {
  const problem = checkGlob(pattern);
  if (problem !== null)
    report(path, `invalid pattern "${pattern}": ${problem}`);
}

function checkCommand(
  value: unknown,
  hook: HookName,
  path: string,
  report: Report,
): void {
  if (typeof value === "function") {
    report(
      path,
      "a function needs a named task: `{ tasks: { name: { run: fn } } }`",
    );
  } else if (typeof value !== "string") {
    report(path, `expected a command string, got ${describe(value)}`);
  } else if (value.trim() === "") {
    report(path, "command is empty");
  } else if (hook !== "pre-push" && value.includes("{push_files}")) {
    // Only `pre-push` gets the refs being pushed.
    report(path, "`{push_files}` is only available in `pre-push`");
  }
}

function unknownOption(key: string, level: keyof typeof KNOWN): string {
  if ((PLANNED[level] as readonly string[]).includes(key)) {
    return "not supported yet";
  }
  return `unknown option${suggest(key, [...KNOWN[level], ...PLANNED[level]])}`;
}

/** `. Did you mean "pre-commit"?` for a close enough name, else "". */
function suggest(input: string, names: readonly string[]): string {
  const limit = Math.max(1, Math.floor(input.length / 3));
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const name of names) {
    const distance = levenshtein(input.toLowerCase(), name.toLowerCase());
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best === undefined ? "" : `. Did you mean "${best}"?`;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** `hooks.pre-commit`, or `tasks["my task"]` for keys that don't read as a path. */
function join(path: string, key: string): string {
  return /^[\w-]+$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return "an empty value";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string") return "a string";
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Bring `"cmd"`, `["a", "b"]` and `{ tasks }` to one shape. Expects a config
 * that passed `validateConfig`.
 */
export function normalizeConfig(config: Config): ResolvedConfig {
  const hooks: Partial<Record<HookName, Hook>> = {};
  for (const [key, value] of Object.entries(config.hooks ?? {})) {
    // Validated: the key is a hook name, as `pre-commit` or `preCommit`.
    const name = resolveHookName(key);
    if (!name) continue;
    const parallel = isObjectForm(value) && value.parallel === true;
    const noBackup = isObjectForm(value) && value.backup === false;
    const noRevert = isObjectForm(value) && value.revert === false;
    hooks[name] = {
      tasks: normalizeTasks(value),
      ...(parallel && { parallel: true }),
      ...(noBackup && { backup: false }),
      ...(noRevert && { revert: false }),
    };
  }
  return { hooks };
}

function normalizeTasks(value: HookConfig): Task[] {
  if (typeof value === "string") return [{ name: value, run: value }];
  if (isCommandList(value)) return value.map((run) => ({ name: run, run }));
  return Object.entries(value.tasks).map(([name, task]) => ({
    name,
    run: task.run,
    ...(task.glob !== undefined && { glob: toList(task.glob) }),
    ...(task.exclude !== undefined && { exclude: toList(task.exclude) }),
    ...(task.symlinks === true && { symlinks: true }),
    ...(task.stageFixed === false && { stageFixed: false }),
  }));
}

function toList(value: string | readonly string[]): readonly string[] {
  return typeof value === "string" ? [value] : [...value];
}

function isObjectForm(
  value: HookConfig,
): value is Exclude<HookConfig, string | readonly string[]> {
  return typeof value === "object" && !isCommandList(value);
}

// `Array.isArray` does not narrow `readonly string[]` out of a union.
function isCommandList(value: HookConfig): value is readonly string[] {
  return Array.isArray(value);
}
