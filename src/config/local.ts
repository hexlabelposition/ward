import { resolveHookName } from "../hooks/list.ts";
import type {
  Config,
  HookConfig,
  LocalConfig,
  LocalHookConfig,
} from "./define.ts";
import { ConfigError } from "./errors.ts";
import { join } from "./schema.ts";

type RawHook = HookConfig | Exclude<LocalHookConfig, null>;

/**
 * Merge `ward.local.*` on top of the main config. Both are validated on
 * their own first; the result is not, since a task added locally may still
 * lack `run`: pass it to `validateConfig`.
 *
 * - Hooks are matched by the hook they name, so a local `preCommit` changes
 *   `pre-commit`. The result uses git's names.
 * - A local command or list of commands replaces the hook, `null` removes it.
 * - A local `{ tasks }` onto a main `{ tasks }`: hook options override, tasks
 *   are merged by name - options key by key, a task keeps its place, new
 *   tasks go last, `null` removes one. Onto a command or a list, or a hook
 *   the main config does not have, it is used as is.
 *
 * @param localName Config name for the message: `ward.local.yml`.
 * @throws ConfigError when `null` removes a hook or task that does not exist,
 *   which is most likely a typo in its name.
 */
export function mergeLocalConfig(
  main: Config,
  local: LocalConfig,
  localName: string,
): unknown {
  const issues: string[] = [];
  const hooks = new Map<string, RawHook>();
  for (const [key, value] of Object.entries(main.hooks ?? {})) {
    hooks.set(resolveHookName(key) ?? key, value);
  }

  for (const [key, value] of Object.entries(local.hooks ?? {})) {
    const name = resolveHookName(key) ?? key;
    const base = hooks.get(name);
    if (value === null) {
      if (!hooks.delete(name)) {
        issues.push(
          `${join("hooks", key)}: no such hook in the main config to remove`,
        );
      }
      continue;
    }
    if (typeof value === "string" || isList(value)) {
      hooks.set(name, value);
      continue;
    }
    if (base === undefined || typeof base === "string" || isList(base)) {
      // Nothing to merge into: `null` tasks have nothing to remove.
      for (const [task, config] of Object.entries(value.tasks ?? {})) {
        if (config === null) {
          issues.push(noTask(key, task));
        }
      }
      hooks.set(name, value);
      continue;
    }

    const { tasks: localTasks, ...localOptions } = value;
    const { tasks: baseTasks, ...baseOptions } = base;
    const tasks: Record<string, unknown> = { ...baseTasks };
    for (const [task, config] of Object.entries(localTasks ?? {})) {
      if (config === null) {
        if (Object.hasOwn(tasks, task)) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete tasks[task];
        } else {
          issues.push(noTask(key, task));
        }
        continue;
      }
      // An existing key keeps its place in the object, a new one goes last.
      tasks[task] = { ...(tasks[task] as object | undefined), ...config };
    }
    hooks.set(name, { ...baseOptions, ...localOptions, tasks } as RawHook);
  }

  if (issues.length > 0) {
    throw new ConfigError(
      `${localName} is invalid:\n${issues.map((issue) => `  ${issue}`).join("\n")}`,
    );
  }
  return { hooks: Object.fromEntries(hooks) };
}

function noTask(hook: string, task: string): string {
  const path = join(join(join("hooks", hook), "tasks"), task);
  return `${path}: no such task in the main config to remove`;
}

// `Array.isArray` does not narrow `readonly string[]` out of a union.
function isList(value: RawHook): value is readonly string[] {
  return Array.isArray(value);
}
