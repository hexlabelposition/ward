import { git, type GitOptions } from "./exec.ts";

/**
 * Files staged for the next commit: added, copied, modified or renamed
 * (`--diff-filter=ACMR`). Deleted files are left out: there is nothing to run
 * a task on. A renamed file is listed under its new path.
 *
 * Paths are relative to the repo root, whatever `cwd` is, with `/` separators
 * on every platform. `-z` keeps them unquoted, so spaces, newlines and
 * non-ASCII names come back as is (`core.quotePath` does not apply).
 *
 * Works before the first commit: the index is compared with an empty tree.
 */
export function getStagedFiles(options: GitOptions = {}): string[] {
  const out = git(
    ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
    options,
  );
  return splitNul(out);
}

/** Split `-z` output; the list ends with a NUL, so drop the empty tail. */
function splitNul(out: string): string[] {
  return out.split("\0").filter((path) => path !== "");
}
