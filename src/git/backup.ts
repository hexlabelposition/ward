import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { addFiles, chunkPaths, MAX_PATHS_LENGTH } from "./add.ts";
import { git, gitBuffer, GitError, type GitOptions } from "./exec.ts";

/** Message of Ward's entries in `git stash list`. */
export const BACKUP_MESSAGE = "ward backup";

/**
 * Save the index and the tracked files of the working tree as a stash commit
 * and return its hash; `null` when there is nothing to save (no changes, or
 * no commit yet to base a stash on) or it can't be saved: the index has
 * unresolved conflicts (`git ls-files --unmerged`), which `git stash create`
 * refuses. `git commit` refuses them too, so this only happens in hooks other
 * than `pre-commit` (`post-checkout` after `git checkout -m`) or when
 * `ward run` is called by hand.
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
  if (git(["ls-files", "--unmerged", "-z"], options) !== "") return null;
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

/** Unstaged changes taken out of partially staged files while tasks run. */
export type HiddenChanges = {
  /**
   * Files whose unstaged changes are in the patch, relative to the repo
   * root.
   */
  readonly files: readonly string[];
  /**
   * Staged files deleted in the working tree: checked out for the tasks,
   * deleted again afterwards.
   */
  readonly deleted: readonly string[];
  /** Absolute path of the patch that holds them, in the git dir. */
  readonly patch: string;
};

/** The unstaged changes could not be put back. */
export class RestoreError extends Error {
  /**
   * Files git could not merge: text files get conflict markers, binary files
   * keep the tasks' version. Empty when nothing was applied.
   */
  readonly conflicts: readonly string[];
  /** Where the patch of the unstaged changes is kept. */
  readonly patch: string;

  constructor(message: string, conflicts: readonly string[], patch: string) {
    super(message);
    this.name = "RestoreError";
    this.conflicts = conflicts;
    this.patch = patch;
  }
}

/** Where the patch is kept, relative to the git dir of the worktree. */
const PATCH = "ward/unstaged.patch";

/**
 * Hide the unstaged changes of partially staged files, so tasks see and fix
 * only what is committed. The changes are saved as a binary patch
 * (`.git/ward/unstaged.patch`) before the files are reset to their index
 * version, so a killed run leaves them recoverable. `null` when no staged
 * file has unstaged changes.
 *
 * A staged file deleted in the working tree is checked out too, so tasks
 * can read it, and deleted again by `restoreUnstagedChanges`; it is not in
 * the patch. Binary files, symlinks, renamed files (by their new path) and
 * type changes (file ↔ symlink) go through the patch like any other change.
 *
 * @param staged Staged files, relative to the repo root (`cwd`).
 */
export function hideUnstagedChanges(
  staged: readonly string[],
  options: GitOptions = {},
): HiddenChanges | null {
  const stagedSet = new Set(staged);
  // `<status>` NUL `<path>` NUL, index against the working tree.
  const fields = git(
    ["diff", "--name-status", "-z", "--no-renames", "--ignore-submodules"],
    options,
  )
    .split("\0")
    .filter((field) => field !== "");
  const entries: [status: string, path: string][] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    entries.push([fields[i] ?? "", fields[i + 1] ?? ""]);
  }
  // An unmerged file is listed as `U` and once more as modified.
  const unmerged = new Set(
    entries.filter(([status]) => status === "U").map(([, path]) => path),
  );
  const files: string[] = [];
  const deleted: string[] = [];
  for (const [status, path] of entries) {
    if (!stagedSet.has(path) || unmerged.has(path)) continue;
    (status === "D" ? deleted : files).push(path);
  }
  if (files.length === 0 && deleted.length === 0) return null;

  const patch = gitPath(PATCH, options);
  mkdirSync(dirname(patch), { recursive: true });
  const chunks = chunkPaths(files, MAX_PATHS_LENGTH).map((chunk) =>
    gitBuffer(
      [
        "--literal-pathspecs",
        "diff",
        "--binary",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        // `diff.noprefix` / `diff.mnemonicPrefix` would break `git apply`.
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--",
        ...chunk,
      ],
      options,
    ),
  );
  writeFileSync(patch, Buffer.concat(chunks));

  for (const chunk of chunkPaths([...files, ...deleted], MAX_PATHS_LENGTH)) {
    git(["checkout-index", "--force", "--", ...chunk], options);
  }
  return { files, deleted, patch };
}

/**
 * Put hidden unstaged changes back on top of what the tasks left, without
 * touching the index: task fixes that were staged stay staged, the user's
 * changes stay unstaged.
 *
 * A plain `git apply` works when the tasks did not touch the lines around
 * the unstaged changes. Otherwise the patch is merged in with
 * `git apply --3way`, against a copy of the index that matches the working
 * tree, so the real index is left alone. The patch file is removed once the
 * changes are back. Files deleted in the working tree before the run are
 * deleted again, whatever the tasks did to them.
 *
 * @throws RestoreError when the changes conflict with the task's (text
 *   files are left with conflict markers, binary files with the task's
 *   version) or can't be applied at all; the patch is kept for both.
 */
export function restoreUnstagedChanges(
  hidden: HiddenChanges,
  options: GitOptions = {},
): void {
  const root = options.cwd ?? process.cwd();
  for (const path of hidden.deleted) {
    rmSync(resolve(root, path), { force: true });
  }
  if (hidden.files.length === 0) {
    rmSync(hidden.patch, { force: true });
    return;
  }

  const apply = ["apply", "--whitespace=nowarn"];
  try {
    git([...apply, hidden.patch], options);
    rmSync(hidden.patch, { force: true });
    return;
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
  }

  const index = `${gitPath(PATCH, options)}.index`;
  try {
    copyFileSync(gitPath("index", options), index);
    const env = { ...(options.env ?? process.env), GIT_INDEX_FILE: index };
    // `--3way` applies to the index too, and needs it to match the files.
    addFiles(hidden.files, { ...options, env });
    git([...apply, "--3way", hidden.patch], { ...options, env });
    rmSync(hidden.patch, { force: true });
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    // `U <path>` for each file left with conflict markers.
    const conflicts = error.stderr
      .split("\n")
      .filter((line) => line.startsWith("U "))
      .map((line) => line.slice(2));
    throw new RestoreError(error.stderr, conflicts, hidden.patch);
  } finally {
    rmSync(index, { force: true });
  }
}

/** Absolute path of `name` in the git dir; follows `GIT_INDEX_FILE` for `index`. */
function gitPath(name: string, options: GitOptions): string {
  const path = git(["rev-parse", "--git-path", name], options);
  return resolve(options.cwd ?? process.cwd(), path);
}

/**
 * Put the index and the tracked files back as they were in the backup
 * (`createBackup`), undoing whatever the tasks changed.
 *
 * Only files that differ from the backup are written, so files the tasks
 * did not touch keep their timestamps. A file the tasks added to the index
 * is taken out of it but left on disk; untracked files are never touched.
 * A file that was in the index but deleted in the working tree at backup
 * time is deleted again.
 */
export function revertToBackup(hash: string, options: GitOptions = {}): void {
  // `<status>` NUL `<path>` NUL; the backup is the old side.
  const fields = git(
    [
      "diff",
      "--name-status",
      "-z",
      "--no-renames",
      "--ignore-submodules",
      hash,
      "--",
    ],
    options,
  )
    .split("\0")
    .filter((field) => field !== "");
  const changed: string[] = [];
  const added: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    // `A`: not in the backup's working tree, nothing to write back.
    (fields[i] === "A" ? added : changed).push(fields[i + 1] ?? "");
  }
  for (const chunk of chunkPaths(changed, MAX_PATHS_LENGTH)) {
    git(["--literal-pathspecs", "checkout", hash, "--", ...chunk], options);
  }
  // In the backup's index but not its working tree: deleted by the user
  // (and checked out for the tasks by `hideUnstagedChanges`).
  const root = options.cwd ?? process.cwd();
  for (const chunk of chunkPaths(added, MAX_PATHS_LENGTH)) {
    const indexed = git(
      [
        "--literal-pathspecs",
        "ls-tree",
        "-r",
        "-z",
        "--name-only",
        "--full-tree",
        `${hash}^2`,
        "--",
        ...chunk,
      ],
      options,
    );
    for (const path of indexed.split("\0")) {
      if (path !== "") rmSync(resolve(root, path), { force: true });
    }
  }
  // The stash's second parent holds the whole index. `reset` with a path
  // rewrites only the entries that differ, unlike `read-tree`.
  git(["reset", "--quiet", `${hash}^2`, "--", "."], options);
}

/** Remove the patch of hidden changes once they no longer need to be applied. */
export function discardHiddenChanges(hidden: HiddenChanges): void {
  rmSync(hidden.patch, { force: true });
}
