import type { HookName } from "../hooks/list.ts";

export type { HookName };

/**
 * A named task. Only `run` for now: `glob`, `exclude`, `stageFixed` and the
 * other task options are added together with the features behind them
 * (0.2 and later).
 */
export type TaskConfig = {
  /** Shell command, run from the repo root. `{1}`, `{2}` … are git hook args. */
  run: string;
};

/**
 * What a hook runs:
 * - `"cmd"` - one command
 * - `["a", "b"]` - commands in order, stop on the first failure
 * - `{ tasks: { name: { run } } }` - named tasks
 */
export type HookConfig =
  | string
  | readonly string[]
  | {
      tasks: Readonly<Record<string, TaskConfig>>;
    };

/** Contents of `ward.config.ts`, `ward.yml` or the `"ward"` section of `package.json`. */
export type Config = {
  /** Hooks without an entry are a no-op. */
  hooks?: Readonly<Partial<Record<HookName, HookConfig>>>;
};

/**
 * Types and autocomplete for `ward.config.ts`; returns the config as is.
 * Validation happens at load time, for every config format (W45).
 *
 * @example
 * export default defineConfig({
 *   hooks: {
 *     "pre-commit": "npm test",
 *     "commit-msg": "commitlint --edit {1}",
 *   },
 * });
 */
export function defineConfig(config: Config): Config {
  return config;
}
