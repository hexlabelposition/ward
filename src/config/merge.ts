import { resolveHookName } from "../hooks/list.ts";
import type { LocalHookConfig } from "./define.ts";
import { ConfigError } from "./errors.ts";
import { type ConfigLayer, join } from "./schema.ts";

type RawHook = Exclude<LocalHookConfig, null>;

/** A config with its name for messages: `ward.yml`, `@company/ward-config`. */
export type NamedLayer = {
  readonly config: ConfigLayer;
  readonly name: string;
};

/**
 * Merge configs in order, each on top of the ones before it: `extends`
 * entries, the config that lists them, `ward.local.*`. Each is validated on
 * its own first (`validateLayer`); the result is not, since a task added in
 * one may still lack `run`: pass it to `validateConfig`. `extends` keys are
 * ignored: `extends.ts` has turned them into layers.
 *
 * - Hooks are matched by the hook they name, so `preCommit` changes
 *   `pre-commit`. The result uses git's names.
 * - A command or a list of commands replaces the hook, `null` removes it.
 * - `{ tasks }` onto `{ tasks }`: hook options override, tasks are merged by
 *   name - options key by key, a task keeps its place, new tasks go last,
 *   `null` removes one. Onto a command or a list, or a hook the configs
 *   before do not have, it is used as is.
 *
 * @throws ConfigError when `null` removes a hook or task that is not there,
 *   which is most likely a typo in its name. Named after the layer.
 */
export function mergeLayers(layers: readonly NamedLayer[]): ConfigLayer {
  const hooks = new Map<string, RawHook>();
  layers.forEach(({ config, name }, i) => {
    const before = layers
      .slice(0, i)
      .map((layer) => layer.name)
      .join(" + ");
    mergeHooks(hooks, config, name, before);
  });
  return { hooks: Object.fromEntries(hooks) };
}

function mergeHooks(
  hooks: Map<string, RawHook>,
  layer: ConfigLayer,
  name: string,
  before: string,
): void {
  const issues: string[] = [];
  const missing = (path: string, what: string) =>
    issues.push(
      before
        ? `${path}: no such ${what} in ${before} to remove`
        : `${path}: no such ${what} to remove, nothing comes before ${name}`,
    );

  for (const [key, value] of Object.entries(layer.hooks ?? {})) {
    const hook = resolveHookName(key) ?? key;
    const base = hooks.get(hook);
    const hookPath = join("hooks", key);
    const taskPath = (task: string) => join(join(hookPath, "tasks"), task);
    if (value === null) {
      if (!hooks.delete(hook)) missing(hookPath, "hook");
      continue;
    }
    if (typeof value === "string" || isList(value)) {
      hooks.set(hook, value);
      continue;
    }
    if (base === undefined || typeof base === "string" || isList(base)) {
      // Nothing to merge into: `null` tasks have nothing to remove.
      for (const [task, config] of Object.entries(value.tasks ?? {})) {
        if (config === null) missing(taskPath(task), "task");
      }
      hooks.set(hook, value);
      continue;
    }

    const { tasks: ownTasks, ...ownOptions } = value;
    const { tasks: baseTasks, ...baseOptions } = base;
    const tasks: Record<string, unknown> = { ...baseTasks };
    for (const [task, config] of Object.entries(ownTasks ?? {})) {
      if (config === null) {
        if (Object.hasOwn(tasks, task)) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete tasks[task];
        } else {
          missing(taskPath(task), "task");
        }
        continue;
      }
      // An existing key keeps its place in the object, a new one goes last.
      tasks[task] = { ...(tasks[task] as object | undefined), ...config };
    }
    hooks.set(hook, { ...baseOptions, ...ownOptions, tasks } as RawHook);
  }

  if (issues.length > 0) {
    throw new ConfigError(
      `${name} is invalid:\n${issues.map((issue) => `  ${issue}`).join("\n")}`,
    );
  }
}

// `Array.isArray` does not narrow `readonly string[]` out of a union.
function isList(value: RawHook): value is readonly string[] {
  return Array.isArray(value);
}
