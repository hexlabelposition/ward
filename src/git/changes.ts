import { git, GitError, type GitOptions } from "./exec.ts";

/** The commit `HEAD` points to, or `null` before the first commit. */
export function getHead(options: GitOptions = {}): string | null {
  try {
    return git(["rev-parse", "--verify", "--quiet", "HEAD"], options);
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/** Whether the index and the tracked files match `HEAD`. Untracked files don't count. */
export function isTreeClean(options: GitOptions = {}): boolean {
  return (
    git(["status", "--porcelain", "-z", "--untracked-files=no"], options) === ""
  );
}

/**
 * Untracked files that are not ignored, relative to the repo root with `/`
 * separators, whatever `cwd` is.
 */
export function listUntracked(options: GitOptions = {}): string[] {
  return git(
    ["ls-files", "--others", "--exclude-standard", "-z", "--full-name", ":/"],
    options,
  )
    .split("\0")
    .filter((path) => path !== "");
}

/**
 * Tracked files whose working tree content differs from `commit`: changed,
 * deleted, or added to the index since. Submodules are left out.
 */
export function changedSince(
  commit: string,
  options: GitOptions = {},
): string[] {
  return git(
    [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      "--ignore-submodules",
      commit,
      "--",
    ],
    options,
  )
    .split("\0")
    .filter((path) => path !== "");
}

/** `git diff` from `commit` to the working tree, as text for the user. */
export function diffSince(
  commit: string,
  { color = false, ...options }: GitOptions & { color?: boolean } = {},
): string {
  return git(
    [
      "diff",
      "--no-ext-diff",
      "--no-renames",
      "--ignore-submodules",
      `--color=${color ? "always" : "never"}`,
      commit,
      "--",
    ],
    options,
  );
}
