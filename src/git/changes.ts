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

/** Lines `start`..`end` of a file, counted from 1, both included. */
export type LineRange = { readonly start: number; readonly end: number };

/**
 * The lines of each file in `commit` that the working tree changes, from
 * `git diff -U0`, for annotations on the files as they are in `commit`. A
 * pure insertion is the line it follows (1 at the top of the file). Files
 * without text hunks (binary, mode changes) are left out.
 */
export function changedLinesSince(
  commit: string,
  options: GitOptions = {},
): Map<string, LineRange[]> {
  const patch = git(
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--unified=0",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--no-prefix",
      "--ignore-submodules",
      "--color=never",
      commit,
      "--",
    ],
    options,
  );
  return parseChangedLines(patch);
}

/** `changedLinesSince` on a patch made with `--no-prefix --unified=0`. */
export function parseChangedLines(patch: string): Map<string, LineRange[]> {
  const ranges = new Map<string, LineRange[]>();
  let header = false;
  let path: string | null = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      header = true;
      path = null;
    } else if (header && line.startsWith("--- ")) {
      // The file in `commit`; a new file has none, so take the `+++` side.
      const old = unquotePath(line.slice(4));
      path = old === "/dev/null" ? null : old;
    } else if (header && line.startsWith("+++ ")) {
      path ??= unquotePath(line.slice(4));
    } else if (line.startsWith("@@ ")) {
      header = false;
      const match = /^@@ -(\d+)(?:,(\d+))? /.exec(line);
      if (path === null || match === null) continue;
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      const range =
        count === 0
          ? { start: Math.max(start, 1), end: Math.max(start, 1) }
          : { start, end: start + count - 1 };
      let list = ranges.get(path);
      if (list === undefined) ranges.set(path, (list = []));
      list.push(range);
    }
  }
  return ranges;
}

/**
 * A path as git prints it in a patch header: as is, or in double quotes with
 * C escapes when it has special characters (octal escapes are UTF-8 bytes).
 */
function unquotePath(text: string): string {
  // A trailing tab follows paths with spaces in some git versions.
  const raw = text.replace(/\t$/, "");
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    "\\": 92,
  };
  const bytes: number[] = [];
  // By code point: a character outside the BMP is two UTF-16 units.
  const chars = Array.from(raw.slice(1, -1));
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] ?? "";
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(chars.slice(i + 1, i + 4).join(""));
    if (octal !== null) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else {
      const next = chars[i + 1] ?? "";
      bytes.push(
        ...(next in escapes ? [escapes[next] ?? 0] : Buffer.from(next, "utf8")),
      );
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}
