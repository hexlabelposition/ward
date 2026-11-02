import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { getRepoPaths, type RepoPaths } from "../git/paths.ts";
import {
  findForeignHooks,
  installHooks,
  type InstallResult,
} from "../hooks/install.ts";
import type { HookName } from "../hooks/list.ts";
import { CHAINED_SUFFIX } from "../hooks/stub.ts";
import { isErrnoCode } from "../util/errors.ts";

const BIN = join("node_modules", ".bin", "ward");

export type InstallOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** `--chain`: keep foreign hooks as `<hook>.pre-ward` and run them before ward. */
  chain?: boolean;
  /**
   * Asks whether to chain the foreign hooks. Default: a y/N prompt when stdin
   * and stdout are a TTY; `null` when there is nobody to ask (`prepare` under
   * most package managers, IDEs), then foreign hooks are left as is.
   */
  confirm?: ((hooks: HookName[], where: string) => Promise<boolean>) | null;
};

/**
 * `ward` with no arguments, run from `"prepare": "ward"`. Returns the exit code.
 *
 * A no-op (exit 0) in CI, outside a git working tree and without git installed,
 * so `npm install` in CI and Docker never fails because of hooks.
 */
export async function install({
  cwd = process.cwd(),
  env = process.env,
  chain = false,
  confirm = defaultConfirm(),
}: InstallOptions = {}): Promise<number> {
  // Checked first: no git process at all in CI.
  if (isCI(env)) {
    console.log("ward: CI detected, skipping hooks install");
    return 0;
  }

  let paths: RepoPaths | null;
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

  const where = toPosix(relative(paths.root, paths.hooksDir));
  if (!chain && confirm) {
    const foreign = findForeignHooks(paths.hooksDir);
    if (foreign.length > 0) chain = await confirm(foreign, where);
  }

  const bin = findBin(cwd, paths.root);
  const result = installHooks(paths.hooksDir, {
    bin: toPosix(relative(paths.root, bin)),
    chain,
  });

  report(result, where);
  return 0;
}

function report(result: InstallResult, where: string) {
  for (const hook of result.chained) {
    console.log(
      `ward: kept existing ${hook} as ${hook}${CHAINED_SUFFIX}, it runs before ward`,
    );
  }

  const skipped = result.foreign.filter((f) => f.reason === "not-chained");
  if (skipped.length > 0) {
    const names = skipped.map((f) => f.hook).join(", ");
    console.warn(
      `ward: hooks not installed by ward found in ${where}: ${names}\n` +
        "ward: left as is, so ward won't run for them. To keep them and run ward after them:\n" +
        "ward:   npx ward --chain",
    );
  }
  for (const { hook, reason } of result.foreign) {
    if (reason === "not-a-file") {
      console.warn(`ward: ${hook} is not a regular file, left as is`);
    } else if (reason === "backup-exists") {
      console.warn(
        `ward: ${hook} left as is: ${hook}${CHAINED_SUFFIX} already exists. ` +
          "Remove one of them and reinstall.",
      );
    }
  }

  const written = result.written.length;
  const total = written + result.unchanged.length;
  const note =
    written === total
      ? ""
      : written === 0
        ? " (up to date)"
        : ` (${String(written)} updated)`;
  console.log(`ward: ${String(total)} hooks installed in ${where}${note}`);
}

function defaultConfirm(): InstallOptions["confirm"] {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  return async (hooks, where) => {
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const answer = await rl.question(
        `ward: found hooks not installed by ward in ${where}: ${hooks.join(", ")}\n` +
          `ward: keep them (moved to <hook>${CHAINED_SUFFIX}, run before ward)? [y/N] `,
      );
      return /^y(es)?$/i.test(answer.trim());
    } finally {
      rl.close();
    }
  };
}

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
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
