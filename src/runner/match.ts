import { createRequire } from "node:module";
import type Picomatch from "picomatch";

/** Decides whether a file (repo-relative path, `/` separators) belongs to a task. */
export type FileMatcher = (path: string) => boolean;

export type MatchOptions = {
  /** Patterns a file must match one of; all files when absent. */
  glob?: readonly string[] | undefined;
  /** Patterns that drop a file even when `glob` matches it. */
  exclude?: readonly string[] | undefined;
};

/**
 * Build a matcher from a task's `glob` and `exclude`.
 *
 * A pattern without `/` matches the file name in any directory (`*.ts` matches
 * `src/a.ts`), as in `.gitignore` and lint-staged. A pattern with `/` matches
 * the whole path from the repo root (`src/*.ts` matches `src/a.ts` only).
 * Dotfiles match like any other file.
 *
 * @throws Error on an invalid pattern (see `checkGlob`).
 */
export function createMatcher({ glob, exclude }: MatchOptions): FileMatcher {
  const include = glob?.map(compileGlob);
  const skip = exclude?.map(compileGlob) ?? [];
  return (path) =>
    (include === undefined || include.some((match) => match(path))) &&
    !skip.some((match) => match(path));
}

/** Files that belong to a task, in their original order. */
export function matchFiles(
  files: readonly string[],
  options: MatchOptions,
): string[] {
  if (options.glob === undefined && options.exclude === undefined) {
    return [...files];
  }
  const match = createMatcher(options);
  return files.filter(match);
}

/**
 * Why a pattern can't be used, or `null` when it is fine: empty, unbalanced
 * brackets, braces or parens, or starting with `./` or `/` (paths are
 * relative to the repo root). Use `/` as the separator on every platform;
 * `\` escapes a special character.
 */
export function checkGlob(pattern: string): string | null {
  if (pattern.trim() === "") return "pattern is empty";
  if (pattern.startsWith("./") || pattern.startsWith("/")) {
    return `patterns are relative to the repo root: write "${pattern.replace(/^\.?\/+/, "")}"`;
  }
  try {
    compileGlob(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function compileGlob(pattern: string): FileMatcher {
  // picomatch's own `basename` option breaks patterns with a `/`, so the file
  // name is picked here.
  const match = picomatch()(pattern, { dot: true, strictBrackets: true });
  if (pattern.includes("/")) return match;
  return (path) => match(path.slice(path.lastIndexOf("/") + 1));
}

let cached: typeof Picomatch | undefined;

/**
 * Loaded on first use: the config is validated on every hook run, and a
 * config without patterns should not pay for the import.
 */
function picomatch(): typeof Picomatch {
  cached ??= createRequire(import.meta.url)("picomatch") as typeof Picomatch;
  return cached;
}
