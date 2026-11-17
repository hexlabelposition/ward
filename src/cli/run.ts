import { readConfig } from "../config/read.ts";
import { getRepoPaths, type RepoPaths } from "../git/paths.ts";
import { getGitOperation } from "../git/state.ts";
import { isHookName } from "../hooks/list.ts";
import { isErrnoCode } from "../util/errors.ts";

export type RunOptions = {
  /** Hook name, as the stub passes it. */
  hook: string | undefined;
  /** Arguments git passed to the hook. */
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** `false` (`--no-backup`): skip the backup even if the config wants it. */
  backup?: boolean;
};

/** Flags of `ward run` itself, given right after the hook name. */
const RUN_FLAGS = ["--no-backup"] as const;

/**
 * Split `ward run` arguments into the hook, Ward's own flags and the hook
 * args git passed. Flags are only read right after the hook name and only
 * known ones: everything from the first other argument (or after `--`) goes
 * to the hook as is, since the stubs pass git's args unparsed.
 */
export function parseRunArgs(argv: readonly string[]): RunOptions {
  const [hook, ...rest] = argv;
  let backup = true;
  let i = 0;
  for (; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--") {
      i++;
      break;
    }
    if (!(RUN_FLAGS as readonly (string | undefined)[]).includes(arg)) break;
    if (arg === "--no-backup") backup = false;
  }
  return { hook, args: rest.slice(i), ...(!backup && { backup }) };
}

/**
 * `ward run <hook> [args]`, called by the stubs. Returns the exit code.
 *
 * A hook with no tasks (no config, or the hook is not in it) exits 0 without
 * output: every hook has a stub, so this is the common case. Otherwise the
 * tasks run in order and the first failure is the exit code.
 * `WARD=0` skips the hook, and so does a merge or rebase in progress.
 * The index and working tree are backed up before the tasks unless the hook
 * sets `backup: false` or `--no-backup` is given.
 */
export async function run({
  hook,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  backup = true,
}: RunOptions): Promise<number> {
  if (hook === undefined) {
    console.error("ward run: missing hook name, e.g. `ward run pre-commit`");
    return 1;
  }
  if (!isHookName(hook)) {
    console.error(`ward run: unknown hook "${hook}"`);
    return 1;
  }

  // The stubs check this themselves; this covers `ward run` called directly.
  if (env.WARD === "0") return 0;

  let paths: RepoPaths | null;
  try {
    paths = getRepoPaths({ cwd, env });
  } catch (error) {
    if (!isErrnoCode(error, "ENOENT")) throw error;
    console.error("ward: git not found");
    return 1;
  }
  if (!paths) {
    console.error("ward: not inside a git working tree");
    return 1;
  }

  // Commits git makes during a merge or rebase are not the user's working
  // changes: checking them again would only get in the way.
  if (getGitOperation(paths.gitDir) !== null) return 0;

  const config = await readConfig(paths.root);
  const tasks = config?.hooks[hook]?.tasks ?? [];
  if (tasks.length === 0) return 0;
  const parallel = config?.hooks[hook]?.parallel === true;
  const withBackup = backup && config?.hooks[hook]?.backup !== false;

  // Imported only when there is something to run: keeps the no-op path fast.
  const { runHook } = await import("../runner/run-hook.ts");
  return runHook({
    hook,
    tasks,
    args,
    root: paths.root,
    env,
    parallel,
    backup: withBackup,
  });
}
