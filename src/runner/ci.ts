import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { revertToBackup, revertToCommit } from "../git/backup.ts";
import {
  changedSince,
  diffSince,
  getHead,
  isTreeClean,
  listUntracked,
} from "../git/changes.ts";
import type { GitOptions } from "../git/exec.ts";

/** What `--ci` compares the tree with after the tasks. */
export type CiCheck = {
  /** The backup (stash commit) of a dirty tree, or `HEAD` of a clean one. */
  readonly base: string;
  readonly isBackup: boolean;
  /** Untracked files before the run: the tasks' new files are the others. */
  readonly untracked: ReadonlySet<string>;
};

/**
 * Note the state before the tasks run. `backup` is the hook's backup, made
 * for `--ci` even when the config turns it off; without one (a clean tree)
 * the tree must match `HEAD`. Returns why the check can't run otherwise.
 */
export function startCiCheck(
  backup: string | null,
  git: GitOptions,
): CiCheck | string {
  let base = backup;
  if (base === null) {
    const head = getHead(git);
    if (head === null) return "--ci needs a commit to compare the tree with";
    // No backup of a dirty tree: unresolved conflicts, which `git stash
    // create` refuses. Reverting to `HEAD` would lose them.
    if (!isTreeClean(git)) {
      return "--ci can't back up the working tree (unresolved conflicts?): resolve, commit or stash the changes first";
    }
    base = head;
  }
  return {
    base,
    isBackup: backup !== null,
    untracked: new Set(listUntracked(git)),
  };
}

/**
 * After the tasks: print the diff of what they changed, put the index and
 * the tracked files back, delete the files they created and return how many
 * files they changed or created.
 */
export function finishCiCheck(
  check: CiCheck,
  git: GitOptions,
  { color = false }: { color?: boolean } = {},
): number {
  const changed = changedSince(check.base, git);
  const created = listUntracked(git).filter(
    (path) => !check.untracked.has(path),
  );

  if (changed.length > 0) {
    console.log(diffSince(check.base, { ...git, color }));
  }
  for (const path of created) console.log(`new file: ${path}`);

  // Also when nothing changed on disk: a task may have changed the index.
  if (check.isBackup) {
    revertToBackup(check.base, git);
  } else {
    revertToCommit(check.base, git);
  }
  const root = git.cwd ?? process.cwd();
  for (const path of created) rmSync(resolve(root, path), { force: true });

  return changed.length + created.length;
}
