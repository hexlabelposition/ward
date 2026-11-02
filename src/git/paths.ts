import { resolve } from "node:path";
import { git, GitError, type GitOptions } from "./exec.ts";

export type RepoPaths = {
  /** Absolute path to the top of the working tree. */
  root: string;
  /** Absolute path to the git dir of this worktree (`.git`, or `.git/worktrees/<name>`). */
  gitDir: string;
  /** Absolute path to the git dir shared by all worktrees (the main `.git`). */
  commonDir: string;
  /**
   * Absolute path to the hooks dir, as git resolves it: shared by all worktrees,
   * honors `core.hooksPath`.
   */
  hooksDir: string;
};

/**
 * Resolve repo paths via one `git rev-parse` call. Never hardcodes `.git/hooks`,
 * so worktrees, submodules and `core.hooksPath` work.
 *
 * Returns `null` outside a working tree (not a repo, bare repo, inside `.git`).
 */
export function getRepoPaths(options: GitOptions = {}): RepoPaths | null {
  const cwd = options.cwd ?? process.cwd();

  let out: string;
  try {
    out = git(
      [
        "rev-parse",
        "--show-toplevel",
        "--git-dir",
        "--git-common-dir",
        "--git-path",
        "hooks",
      ],
      { ...options, cwd },
    );
  } catch (error) {
    // 128: "not a git repository" / "must be run in a work tree".
    if (error instanceof GitError && error.status === 128) return null;
    throw error;
  }

  const [root, gitDir, commonDir, hooksDir] = out.split(/\r?\n/);
  if (!root || !gitDir || !commonDir || !hooksDir) return null;

  // `--git-dir`, `--git-common-dir` and `--git-path` may be relative to cwd; `resolve` also turns
  // git's `C:/…` into native separators on Windows.
  return {
    root: resolve(root),
    gitDir: resolve(cwd, gitDir),
    commonDir: resolve(cwd, commonDir),
    hooksDir: resolve(cwd, hooksDir),
  };
}
