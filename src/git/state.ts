import { existsSync } from "node:fs";
import { join } from "node:path";

export type GitOperation = "merge" | "rebase";

/**
 * The merge or rebase in progress in this worktree, or `null`.
 *
 * Reads the markers git keeps in the git dir: `MERGE_HEAD` while a merge
 * waits for its commit, `rebase-merge/` and `rebase-apply/` during a rebase
 * (`rebase-apply/` also during `git am`).
 *
 * @param gitDir Git dir of the worktree (`RepoPaths.gitDir`), not the common
 *   dir: each worktree has its own state.
 */
export function getGitOperation(gitDir: string): GitOperation | null {
  if (
    existsSync(join(gitDir, "rebase-merge")) ||
    existsSync(join(gitDir, "rebase-apply"))
  ) {
    return "rebase";
  }
  if (existsSync(join(gitDir, "MERGE_HEAD"))) return "merge";
  return null;
}
