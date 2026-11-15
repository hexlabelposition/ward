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

/**
 * Every file in the index (`git ls-files`), relative to the repo root even
 * when `cwd` is a subdirectory. A conflicted file is listed once, not once per
 * stage.
 */
export function getAllFiles(options: GitOptions = {}): string[] {
  const out = git(["ls-files", "-z", "--full-name", "--", ":/"], options);
  return unique(splitNul(out));
}

/** One line of `pre-push` stdin: `<local ref> <local sha> <remote ref> <remote sha>`. */
export type PushUpdate = {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
};

/** Parse `pre-push` stdin. Blank lines are skipped; a malformed line throws. */
export function parsePushInput(input: string): PushUpdate[] {
  const updates: PushUpdate[] = [];
  for (const line of input.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const parts = line.trim().split(/\s+/);
    const [localRef, localSha, remoteRef, remoteSha] = parts;
    if (
      parts.length !== 4 ||
      !localRef ||
      !remoteRef ||
      !isSha(localSha) ||
      !isSha(remoteSha)
    ) {
      throw new Error(
        `Unexpected pre-push input line: ${JSON.stringify(line)}`,
      );
    }
    updates.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return updates;
}

/**
 * Files changed by the commits a push sends, as they are in the pushed
 * commit: added, copied, modified or renamed, and still present there.
 *
 * The pushed commits are those reachable from the local sha but not from the
 * remote sha or any remote-tracking branch of `remote`. So a new branch only
 * brings its own commits, not the whole history it was forked from. A deleted
 * ref brings nothing. When `remote` is a URL (`git push <url>`), there are no
 * remote-tracking branches to exclude and every commit the remote doesn't
 * have by sha counts.
 *
 * @param updates Parsed `pre-push` stdin (`parsePushInput`).
 * @param remote The first `pre-push` argument: remote name or URL.
 */
export function getPushFiles(
  updates: readonly PushUpdate[],
  remote: string,
  options: GitOptions = {},
): string[] {
  const files: string[] = [];
  for (const { localSha, remoteSha } of updates) {
    if (isZeroSha(localSha)) continue; // ref deletion

    const exclude = [`--remotes=${remote}`];
    // A remote sha we don't have (someone else pushed) can't be excluded.
    if (!isZeroSha(remoteSha) && hasCommit(remoteSha, options)) {
      exclude.push(remoteSha);
    }

    const changed = splitNul(
      git(
        [
          "log",
          "--format=",
          "--name-only",
          "-z",
          "--diff-filter=ACMR",
          localSha,
          "--not",
          ...exclude,
          "--",
        ],
        options,
      ),
    );
    if (changed.length === 0) continue;

    // Drop files a later commit deleted or renamed away.
    const present = new Set(
      splitNul(
        git(
          ["ls-tree", "-r", "-z", "--name-only", "--full-tree", localSha],
          options,
        ),
      ),
    );
    files.push(...changed.filter((path) => present.has(path)));
  }
  return unique(files);
}

function hasCommit(sha: string, options: GitOptions): boolean {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`], options);
    return true;
  } catch {
    return false;
  }
}

function isSha(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value);
}

function isZeroSha(sha: string): boolean {
  return /^0+$/.test(sha);
}

/** Split `-z` output; the list ends with a NUL, so drop the empty tail. */
function splitNul(out: string): string[] {
  return out.split("\0").filter((path) => path !== "");
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}
