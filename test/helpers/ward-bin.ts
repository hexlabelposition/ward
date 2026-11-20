import { chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { TempRepo } from "./git-repo.ts";

/** The source CLI, run without a build. */
export const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

/**
 * Write a ward binary at `path` that runs the source CLI on the runtime
 * running the tests, like the one a package manager puts in
 * `node_modules/.bin`.
 *
 * It is both a shell script and JS, because stubs start it either way: a Node
 * stub executes it (`"$bin"`, sh runs line 2 and execs), a Bun stub passes it
 * to `bun "$bin"` (line 2 is a string and a comment, line 3 loads the CLI).
 */
export function writeWardBin(
  repo: TempRepo,
  path = "node_modules/.bin/ward",
): void {
  const posix = (p: string) => p.replaceAll("\\", "/");
  repo.write(
    path,
    `#!/bin/sh
":" //; exec "${posix(process.execPath)}" "${posix(CLI)}" "$@"
import(${JSON.stringify(pathToFileURL(CLI).href)});
`,
  );
  chmodSync(join(repo.dir, path), 0o755);
}
