import type { CamelHookName, HookName } from "../hooks/list.ts";

export type { CamelHookName, HookName };

/** What a function task gets. */
export type TaskContext = {
  /**
   * Files of the hook that match the task's `glob` / `exclude`, relative to
   * the repo root (the working directory while the function runs): staged
   * files in `pre-commit`, pushed files in `pre-push`, none in other hooks.
   */
  files: string[];
  /** Arguments git passed to the hook: `args[0]` is `{1}`. */
  args: string[];
};

/**
 * A task run in Ward's own process. It fails when it throws or the promise
 * it returns rejects; the returned value is ignored otherwise.
 */
export type TaskFunction = (context: TaskContext) => unknown;

/**
 * A named task. Further task options are added together with the features
 * behind them.
 */
export type TaskConfig = {
  /**
   * Shell command, run from the repo root. `{1}`, `{2}` … are git hook args.
   * In `ward.config.ts` it can also be a function that gets the files.
   */
  run: string | TaskFunction;
  /**
   * Files the task runs on: one pattern or a list, any of them may match.
   * A pattern without `/` matches the file name in any directory (`"*.ts"`),
   * one with `/` the path from the repo root (`"src/*.ts"` matches `src/a.ts` only).
   */
  glob?: string | readonly string[];
  /** Files to leave out even when `glob` matches them, same pattern rules. */
  exclude?: string | readonly string[];
  /**
   * Pass symlinks to the task too. Off by default: a formatter would rewrite
   * the file the link points to.
   */
  symlinks?: boolean;
  /**
   * `git add` the staged files the task changed, so a formatter's fixes go
   * into the commit. On by default; `false` leaves them unstaged.
   */
  stageFixed?: boolean;
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
      /**
       * Start all tasks at once and let each run to the end; the hook fails
       * if any of them fails. Tasks run one after another by default.
       */
      parallel?: boolean;
      /**
       * Save the index and working tree with `git stash create` before the
       * run, so they can be restored if a task breaks them. On by default;
       * `false` skips it to save time in large repos.
       */
      backup?: boolean;
      /**
       * When a task fails, put the index and working tree back as they were
       * before the run, from the backup. On by default; `false` keeps the
       * tasks' changes for inspection. Needs `backup`.
       */
      revert?: boolean;
    };

/** Contents of `ward.config.ts`, `ward.yml` or the `"ward"` section of `package.json`. */
export type Config = {
  /**
   * Hooks without an entry are a no-op. A hook can be named as in git
   * (`"pre-commit"`) or in camelCase (`preCommit`), not both.
   */
  hooks?: Readonly<Partial<Record<HookName | CamelHookName, HookConfig>>>;
};

/**
 * Types and autocomplete for `ward.config.ts`; returns the config as is.
 * Validation happens at load time, for every config format (W45).
 *
 * @example
 * export default defineConfig({
 *   hooks: {
 *     preCommit: "npm test",
 *     "commit-msg": "commitlint --edit {1}",
 *   },
 * });
 */
export function defineConfig(config: Config): Config {
  return config;
}
