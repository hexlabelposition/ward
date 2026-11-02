import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { getRepoPaths } from "../git/paths.ts";
import { installHooks } from "../hooks/install.ts";
import { isErrnoCode } from "../util/errors.ts";

const BIN = join("node_modules", ".bin", "ward");

export type InstallOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * `ward` with no arguments, run from `"prepare": "ward"`. Returns the exit code.
 *
 * A no-op (exit 0) in CI, outside a git working tree and without git installed,
 * so `npm install` in CI and Docker never fails because of hooks.
 */
export function install({
  cwd = process.cwd(),
  env = process.env,
}: InstallOptions = {}): number {
  // Checked first: no git process at all in CI.
  if (isCI(env)) {
    console.log("ward: CI detected, skipping hooks install");
    return 0;
  }

  let paths;
  try {
    paths = getRepoPaths({ cwd, env });
  } catch (error) {
    if (!isErrnoCode(error, "ENOENT")) throw error;
    console.log("ward: git not found, skipping hooks install");
    return 0;
  }
  if (!paths) {
    console.log("ward: not inside a git working tree, skipping hooks install");
    return 0;
  }

  // `--git-path hooks` follows `core.hooksPath`: don't write stubs into a
  // directory another tool (or the repo) owns. `--respect-hooks-path` is W41.
  if (paths.hooksDir !== join(paths.commonDir, "hooks")) {
    console.error(
      `ward: core.hooksPath is set (${paths.hooksDir}), git ignores .git/hooks.\n` +
        "ward: hooks not installed. Run `git config --unset core.hooksPath` and reinstall.",
    );
    return 1;
  }

  const bin = findBin(cwd, paths.root);
  const result = installHooks(paths.hooksDir, {
    bin: relative(paths.root, bin).replaceAll("\\", "/"),
  });

  for (const hook of result.foreign) {
    console.warn(
      `ward: ${hook} exists and is not managed by ward, left as is (ward won't run it)`,
    );
  }
  const where = relative(paths.root, paths.hooksDir).replaceAll("\\", "/");
  const written = result.written.length;
  const total = written + result.unchanged.length;
  const note =
    written === total
      ? ""
      : written === 0
        ? " (up to date)"
        : ` (${String(written)} updated)`;
  console.log(`ward: ${String(total)} hooks installed in ${where}${note}`);
  return 0;
}

/** `CI` is set by GitHub Actions, GitLab, CircleCI, Travis, Buildkite, Azure Pipelines and others. */
function isCI(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI?.trim().toLowerCase();
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
}

/**
 * The ward binary, looked up from `cwd` towards the repo root, so `prepare` in a
 * workspace package finds a hoisted root `node_modules` as well as its own.
 * Falls back to `<root>/node_modules/.bin/ward`.
 */
function findBin(cwd: string, root: string): string {
  let dir = resolve(cwd);
  for (;;) {
    const bin = join(dir, BIN);
    if (existsSync(bin)) return bin;
    if (dir === root || relative(root, dir).startsWith("..")) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(root, BIN);
}
