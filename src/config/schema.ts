import type { HookName } from "../hooks/list.ts";
import type { Config, HookConfig } from "./define.ts";

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
 * Bring `"cmd"`, `["a", "b"]` and `{ tasks }` to one shape. Expects a config
 * that already passed validation (W45).
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
