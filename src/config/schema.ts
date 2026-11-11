import { HOOKS, type HookName, isHookName } from "../hooks/list.ts";
import type { Config, HookConfig } from "./define.ts";
import { ConfigError } from "./errors.ts";

/**
 * Internal model every config form is normalized to. Fields are added with
 * the features that use them (`glob`, `parallel`, `backup`, ...).
 */
export type Task = {
  /** Key in `{ tasks }`; for the string and array forms, the command itself. */
  readonly name: string;
  readonly run: string;
};

export type Hook = {
  /** In config order. */
  readonly tasks: readonly Task[];
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
  hook: ["parallel", "backup", "revert"],
  task: [
    "glob",
    "exclude",
    "root",
    "tags",
    "stageFixed",
    "symlinks",
    "cache",
    "dependsOn",
  ],
} as const;

const KNOWN = {
  config: ["hooks"],
  hook: ["tasks"],
  task: ["run"],
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
    if (isHookName(key)) {
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
  for (const [hook, value] of Object.entries(hooks)) {
    const path = join("hooks", hook);
    if (!isHookName(hook)) {
      report(path, `unknown hook${suggest(hook, HOOKS)}`);
      continue;
    }
    checkHook(value, path, report);
  }
}

function checkHook(value: unknown, path: string, report: Report): void {
  if (typeof value === "string") {
    checkCommand(value, path, report);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((command: unknown, i) => {
      checkCommand(command, `${path}[${String(i)}]`, report);
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
    if (key !== "tasks") report(join(path, key), unknownOption(key, "hook"));
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
    checkTask(task, taskPath, report);
  }
}

function checkTask(task: unknown, path: string, report: Report): void {
  if (!isObject(task)) {
    report(path, `expected \`{ run: "…" }\`, got ${describe(task)}`);
    return;
  }
  for (const key of Object.keys(task)) {
    if (key !== "run") report(join(path, key), unknownOption(key, "task"));
  }
  if (!Object.hasOwn(task, "run")) {
    report(path, "missing `run`");
    return;
  }
  if (typeof task.run === "function") {
    report(join(path, "run"), "function tasks are not supported yet");
    return;
  }
  checkCommand(task.run, join(path, "run"), report);
}

function checkCommand(value: unknown, path: string, report: Report): void {
  if (typeof value !== "string") {
    report(path, `expected a command string, got ${describe(value)}`);
  } else if (value.trim() === "") {
    report(path, "command is empty");
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
  for (const [name, value] of Object.entries(config.hooks ?? {}) as [
    HookName,
    HookConfig,
  ][]) {
    hooks[name] = { tasks: normalizeTasks(value) };
  }
  return { hooks };
}

function normalizeTasks(value: HookConfig): Task[] {
  if (typeof value === "string") return [{ name: value, run: value }];
  if (isCommandList(value)) return value.map((run) => ({ name: run, run }));
  return Object.entries(value.tasks).map(([name, { run }]) => ({ name, run }));
}

// `Array.isArray` does not narrow `readonly string[]` out of a union.
function isCommandList(value: HookConfig): value is readonly string[] {
  return Array.isArray(value);
}
