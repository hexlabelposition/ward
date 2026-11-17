import { git, type GitOptions } from "./exec.ts";

/**
 * Longest total length of paths in one `git add`. Windows caps the whole
 * command line at 32 767 characters; POSIX allows far more, but a bounded
 * chunk costs nothing. Git ≥ 2.20 has no `--pathspec-from-file`, so long
 * lists go in several calls. Used for every git command that takes paths.
 */
export const MAX_PATHS_LENGTH = 8000;

/**
 * `git add` the given paths, relative to the repo root (`cwd`). A path gone
 * from the working tree stages its deletion. Paths are literal
 * (`--literal-pathspecs`), so `[id].ts` or `*.md` add only that file.
 */
export function addFiles(
  paths: readonly string[],
  options: GitOptions = {},
): void {
  for (const chunk of chunkPaths(paths, MAX_PATHS_LENGTH)) {
    git(["--literal-pathspecs", "add", "--", ...chunk], options);
  }
}

/** Split `paths` so each chunk's paths add up to at most `maxLength` characters. */
export function chunkPaths(
  paths: readonly string[],
  maxLength: number,
): string[][] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let size = 0;
  for (const path of paths) {
    const cost = path.length + 1;
    if (chunk.length > 0 && size + cost > maxLength) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(path);
    size += cost;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}
