import { readConfig } from "../config/read.ts";
import { getRepoPaths, type RepoPaths } from "../git/paths.ts";
import { getGitOperation } from "../git/state.ts";
import { isHookName } from "../hooks/list.ts";
import { refreshStaleStubs } from "../hooks/refresh.ts";
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
  /** `false` (`--no-revert`): keep task changes when the hook fails. */
  revert?: boolean;
  /**
   * `--from-ref <ref>`: the hook's files are those changed on the branch
   * since it forked from `ref`, instead of the staged or pushed files.
   */
  fromRef?: string;
  /** `--all-files`: every tracked file instead of the staged or pushed ones. */
  allFiles?: boolean;
  /** `--ci`: check without keeping fixes; fail if the tasks change files. */
  ci?: boolean;
};

/** Flags of `ward run` itself, given right after the hook name. */
const RUN_FLAGS = [
  "--no-backup",
  "--no-revert",
  "--from-ref",
  "--all-files",
  "--ci",
] as const;

/**
 * Split `ward run` arguments into the hook, Ward's own flags and the hook
 * args git passed. Flags are only read right after the hook name and only
 * known ones: everything from the first other argument (or after `--`) goes
 * to the hook as is, since the stubs pass git's args unparsed.
 */
export function parseRunArgs(argv: readonly string[]): RunOptions {
  const [hook, ...rest] = argv;
  let backup = true;
  let revert = true;
  let fromRef: string | undefined;
  let allFiles = false;
  let ci = false;
  let i = 0;
  for (; i < rest.length; i++) {
    const arg = rest[i] ?? "";
    if (arg === "--") {
      i++;
      break;
    }
    const [flag, inline] = splitFromRef(arg);
    if (!(RUN_FLAGS as readonly string[]).includes(flag)) break;
    if (flag === "--no-backup") backup = false;
    if (flag === "--no-revert") revert = false;
    if (flag === "--all-files") allFiles = true;
    if (flag === "--ci") ci = true;
    if (flag === "--from-ref") {
      const value = inline ?? rest[++i];
      // A value starting with `-` would reach git as an option.
      if (!value || value.startsWith("-")) {
        throw new Error(
          "--from-ref needs a ref, e.g. `ward run pre-commit --from-ref origin/main`",
        );
      }
      fromRef = value;
    }
  }
  if (fromRef !== undefined && allFiles) {
    throw new Error("use either --from-ref or --all-files, not both");
  }
  // In CI nothing is staged: `--ci` alone would check no files and pass.
  if (ci && fromRef === undefined && !allFiles) {
    throw new Error(
      "--ci needs the files to check: add --from-ref <ref> or --all-files",
    );
  }
  if (ci && (!backup || !revert)) {
    throw new Error(
      "--ci always backs up and restores the tree: drop --no-backup and --no-revert",
    );
  }
  return {
    hook,
    args: rest.slice(i),
    ...(!backup && { backup }),
    ...(!revert && { revert }),
    ...(fromRef !== undefined && { fromRef }),
    ...(allFiles && { allFiles }),
    ...(ci && { ci }),
  };
}

/** `--from-ref=main` → `["--from-ref", "main"]`; other args as they are. */
function splitFromRef(arg: string): [string, string?] {
  const prefix = "--from-ref=";
  return arg.startsWith(prefix)
    ? ["--from-ref", arg.slice(prefix.length)]
    : [arg];
}

/**
 * `ward run <hook> [args]`, called by the stubs. Returns the exit code.
 *
 * A hook with no tasks (no config, or the hook is not in it) exits 0 without
 * output: every hook has a stub, so this is the common case. Otherwise the
 * tasks run in order and the first failure is the exit code.
 * `WARD=0` skips the hook, and so does a merge or rebase in progress.
 * Stubs written by another Ward version are rewritten first.
 * The index and working tree are backed up before the tasks unless the hook
 * sets `backup: false` or `--no-backup` is given, and the hook goes back to
 * the backup when it fails unless it sets `revert: false` or `--no-revert`
 * is given. `--from-ref <ref>` runs the tasks on the files changed since
 * `ref`, and `--all-files` on every tracked file, instead of the staged or
 * pushed ones (`runHook`). `--ci` checks without keeping fixes and fails
 * if the tasks change files.
 */
export async function run({
  hook,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  backup = true,
  revert = true,
  fromRef,
  allFiles = false,
  ci = false,
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

  // Before anything that can return early: most hooks have nothing to run.
  const refreshed = await refreshStaleStubs(paths.hooksDir, hook);
  if (refreshed.length > 0) {
    console.error("ward: updated the git hook stubs for this Ward version");
  }

  // Commits git makes during a merge or rebase are not the user's working
  // changes: checking them again would only get in the way.
  if (getGitOperation(paths.gitDir) !== null) return 0;

  // Checked before the config: a ref missing in CI is the likely mistake.
  if (fromRef !== undefined) {
    const { checkFromRef } = await import("../git/files.ts");
    const problem = checkFromRef(fromRef, { cwd: paths.root, env });
    if (problem !== null) {
      console.error(`ward: ${problem}`);
      return 1;
    }
  }

  const config = await readConfig(paths.root);
  const tasks = config?.hooks[hook]?.tasks ?? [];
  if (tasks.length === 0) return 0;
  const parallel = config?.hooks[hook]?.parallel === true;
  const withBackup = backup && config?.hooks[hook]?.backup !== false;
  const withRevert = revert && config?.hooks[hook]?.revert !== false;

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
    revert: withRevert,
    ...(fromRef !== undefined && { fromRef }),
    ...(allFiles && { allFiles }),
    ...(ci && { ci }),
  });
}
