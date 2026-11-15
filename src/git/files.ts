import { git, type GitOptions } from "./exec.ts";

/** A file from one of the lists below. */
export type GitFile = {
  /** Relative to the repo root, `/` separators. */
  path: string;
  /** Stored by git as a symlink (mode `120000`), whatever the platform. */
  symlink: boolean;
};

const SYMLINK = "120000";
/** A submodule: a commit, not a file a task could read. */
const GITLINK = "160000";

/**
 * Files staged for the next commit: added, copied, modified or renamed
 * (`--diff-filter=ACMR`). Deleted files are left out: there is nothing to run
 * a task on, and so are submodules. A renamed file is listed under its new
 * path. `symlink` is the staged mode.
 *
 * Paths are relative to the repo root, whatever `cwd` is, with `/` separators
 * on every platform. `-z` keeps them unquoted, so spaces, newlines and
 * non-ASCII names come back as is (`core.quotePath` does not apply).
 *
 * Works before the first commit: the index is compared with an empty tree.
 */
export function getStagedFiles(options: GitOptions = {}): GitFile[] {
  const out = git(
    ["diff", "--cached", "--raw", "-z", "--diff-filter=ACMR"],
    options,
  );
  // `:<old mode> <new mode> <old sha> <new sha> <status>` NUL `<path>` NUL,
  // with a second path (the new one) for renames and copies.
  const files: GitFile[] = [];
  const fields = splitNul(out);
  for (let i = 0; i < fields.length; i++) {
    const [, mode = "", , , status = ""] = (fields[i] ?? "").split(" ");
    if (status.startsWith("R") || status.startsWith("C")) i++;
    const path = fields[++i];
    if (path !== undefined) files.push(...toFile(mode, path));
  }
  return files;
}

/**
 * Every file in the index (`git ls-files`) except submodules, relative to the
 * repo root even when `cwd` is a subdirectory. A conflicted file is listed
 * once, not once per stage.
 */
export function getAllFiles(options: GitOptions = {}): GitFile[] {
  const out = git(
    ["ls-files", "--stage", "-z", "--full-name", "--", ":/"],
    options,
  );
  // `<mode> <sha> <stage>` TAB `<path>`
  const files = new Map<string, GitFile>();
  for (const entry of splitNul(out)) {
    const tab = entry.indexOf("\t");
    const path = entry.slice(tab + 1);
    if (files.has(path)) continue;
    for (const file of toFile(entry.slice(0, entry.indexOf(" ")), path)) {
      files.set(path, file);
    }
  }
  return [...files.values()];
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
 * Submodules are left out; `symlink` is the mode in the pushed commit.
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
): GitFile[] {
  const files = new Map<string, GitFile>();
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

    // Modes in the pushed commit; files a later commit deleted or renamed
    // away are not there.
    const modes = new Map<string, string>();
    const tree = git(["ls-tree", "-r", "-z", "--full-tree", localSha], options);
    for (const entry of splitNul(tree)) {
      // `<mode> <type> <sha>` TAB `<path>`
      const tab = entry.indexOf("\t");
      modes.set(entry.slice(tab + 1), entry.slice(0, entry.indexOf(" ")));
    }
    for (const path of changed) {
      const mode = modes.get(path);
      if (mode === undefined || files.has(path)) continue;
      for (const file of toFile(mode, path)) files.set(path, file);
    }
  }
  return [...files.values()];
}

/** The file for a git mode, or nothing for a submodule. */
function toFile(mode: string, path: string): GitFile[] {
  if (mode === GITLINK) return [];
  return [{ path, symlink: mode === SYMLINK }];
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
