import { chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { TempRepo } from "./git-repo.ts";

/** The source CLI, run without a build. */
export const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

const isDeno = process.versions.deno !== undefined;

/**
 * Write a ward binary at `path` that runs the source CLI on the runtime
 * running the tests, like the one a package manager puts in
 * `node_modules/.bin`, and make the repo's stubs use it (`useWardBin`).
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
  // A shell has no Deno's spawn rewrite: `deno <file>` would get no permissions.
  const run = isDeno ? " run -A" : "";
  repo.write(
    path,
    `#!/bin/sh
":" //; exec "${posix(process.execPath)}"${run} "${posix(CLI)}" "$@"
import(${JSON.stringify(pathToFileURL(CLI).href)});
`,
  );
  chmodSync(join(repo.dir, path), 0o755);
  useWardBin(repo);
}

/**
 * Make the stubs installed in `repo` run the binary. On Deno, install writes
 * Deno stubs, which run ward from npm (`deno run -A npm:@hexlabelposition/ward`)
 * instead of this source, so git commands in this repo get
 * `WARD_RUNTIME=node`. stub.test covers the Deno branch with a fake `deno`.
 */
export function useWardBin(repo: TempRepo): void {
  if (isDeno) repo.env.WARD_RUNTIME = "node";
}

/**
 * A shell command that runs a JS snippet (no double quotes) on the runtime
 * running the tests, like `node -e`: `process.argv.slice(1)` are the
 * arguments and `require` works.
 */
export function evalCommand(script: string): string {
  if (!isDeno) return `"${process.execPath}" -e "${script}"`;
  // `deno eval` is a module with the eval file at argv[1].
  return `"${process.execPath}" eval "const require = (await import('node:module')).createRequire(import.meta.url); process.argv.splice(1, 1); ${script}"`;
}
