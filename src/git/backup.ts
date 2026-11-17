import { git, GitError, type GitOptions } from "./exec.ts";

/** Message of Ward's entries in `git stash list`. */
export const BACKUP_MESSAGE = "ward backup";

/**
 * Save the index and the tracked files of the working tree as a stash commit
 * and return its hash; `null` when there is nothing to save (no changes, or
 * no commit yet to base a stash on).
 *
 * `git stash create` writes the commit without touching the working tree or
 * the index. The commit is also added to `git stash list` as "ward backup",
 * so the state before a run can be found and restored by hand even if Ward
 * is killed mid-run. Untracked files are not part of it.
 *
 * Works inside a hook with the index git sets in `GIT_INDEX_FILE`
 * (`git commit -a`, `git commit <paths>`): that is the index being committed.
 */
export function createBackup(options: GitOptions = {}): string | null {
  // Without a commit, `git stash create` fails: "You do not have the initial
  // commit yet".
  if (!hasHead(options)) return null;
  const hash = git(["stash", "create", BACKUP_MESSAGE], options);
  if (hash === "") return null;
  git(["stash", "store", "--quiet", "-m", BACKUP_MESSAGE, hash], options);
  return hash;
}

/**
 * Remove the backup from `git stash list`. Looked up by hash, not position:
 * a task may have pushed or popped stash entries meanwhile. A no-op when the
 * entry is already gone.
 */
export function dropBackup(hash: string, options: GitOptions = {}): void {
  const index = git(["stash", "list", "--format=%H"], options)
    .split("\n")
    .indexOf(hash);
  if (index === -1) return;
  git(["stash", "drop", "--quiet", `stash@{${String(index)}}`], options);
}

function hasHead(options: GitOptions): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", "HEAD"], options);
    return true;
  } catch (error) {
    if (error instanceof GitError) return false;
    throw error;
  }
}
