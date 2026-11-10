import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getConfig } from "../git/config.ts";
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
   * `--respect-hooks-path`: when `core.hooksPath` is set, install into that
   * directory instead of refusing. Only for a directory inside the repo, never
   * one shared with other repos.
   */
  respectHooksPath?: boolean;
  /** `--force`: replace foreign hooks with stubs, without asking. */
  force?: boolean;
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
  respectHooksPath = false,
  force = false,
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
  // directory another tool (or the repo) owns unless asked to.
  if (paths.hooksDir !== join(paths.commonDir, "hooks")) {
    const ownDir = isRepoOwned(paths);
    if (!respectHooksPath || !ownDir) {
      reportHooksPath(paths, { cwd, env }, { respectHooksPath, ownDir });
      return 1;
    }
  }

  const where = toPosix(relative(paths.root, paths.hooksDir));
  if (!chain && !force && confirm) {
    const foreign = findForeignHooks(paths.hooksDir);
    if (foreign.length > 0) chain = await confirm(foreign, where);
  }

  const bin = findBin(cwd, paths.root);
  const result = installHooks(paths.hooksDir, {
    bin: toPosix(relative(paths.root, bin)),
    chain,
    force,
  });

  const rerun = respectHooksPath ? "npx ward --respect-hooks-path" : "npx ward";
  report(result, where, rerun);
  return 0;
}

/** `rerun`: the command that reproduces this install, for hints. */
function report(result: InstallResult, where: string, rerun: string) {
  for (const hook of result.chained) {
    console.log(
      `ward: kept existing ${hook} as ${hook}${CHAINED_SUFFIX}, it runs before ward`,
    );
  }
  if (result.overwritten.length > 0) {
    console.warn(
      `ward: replaced hooks not installed by ward: ${result.overwritten.join(", ")}`,
    );
  }

  const skipped = result.foreign.filter((f) => f.reason === "not-chained");
  if (skipped.length > 0) {
    const names = skipped.map((f) => f.hook).join(", ");
    console.warn(
      `ward: hooks not installed by ward found in ${where}: ${names}\n` +
        "ward: left as is, so ward won't run for them. To fix:\n" +
        `ward:   ${rerun} --chain   # keep them, run ward after them\n` +
        `ward:   ${rerun} --force   # replace them with ward's hooks`,
    );
  }
  for (const { hook, reason } of result.foreign) {
    if (reason === "not-a-file") {
      console.warn(`ward: ${hook} is not a regular file, left as is`);
    } else if (reason === "backup-exists") {
      console.warn(
        `ward: ${hook} left as is: ${hook}${CHAINED_SUFFIX} already exists. ` +
          `Remove one of them and reinstall, or replace ${hook}: ${rerun} --chain --force`,
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

/**
 * The hooks dir belongs to this repo: inside the working tree or the git dir.
 * A dir outside (`core.hooksPath=~/.githooks`) is shared with every repo that
 * uses it, and the working tree root itself would get a file per hook.
 */
function isRepoOwned({ root, commonDir, hooksDir }: RepoPaths): boolean {
  return [root, commonDir].some((parent) => {
    const rel = relative(parent, hooksDir);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
}

/** Why install stopped on `core.hooksPath`, and how to fix it. */
function reportHooksPath(
  { root, hooksDir }: RepoPaths,
  gitOptions: { cwd: string; env: NodeJS.ProcessEnv },
  { respectHooksPath, ownDir }: { respectHooksPath: boolean; ownDir: boolean },
) {
  const config = getConfig("core.hooksPath", gitOptions);
  const shown = ownDir ? toPosix(relative(root, hooksDir)) : hooksDir;
  const value = config?.value ?? shown;
  const scope = config?.scope ? ` (${config.scope} config)` : "";
  const lines = [
    `core.hooksPath is set to "${value}"${scope}: git runs hooks from ${shown} and ignores .git/hooks.`,
  ];

  if (respectHooksPath) {
    lines.push(
      `not installing into ${shown}: only a directory inside this repo is supported, ` +
        "not the repo root or one shared with other repos.",
    );
  }
  lines.push("hooks not installed. To fix:");

  const unset = unsetCommand(config?.scope ?? null);
  const fixes: [command: string, note: string][] = [];
  if (unset) fixes.push([unset, "use .git/hooks, then run: npx ward"]);
  if (ownDir)
    fixes.push(["npx ward --respect-hooks-path", `install into ${shown}`]);
  if (!unset) {
    lines.push(
      "  remove core.hooksPath from git -c / GIT_CONFIG_*, then run: npx ward",
    );
  }
  const width = Math.max(...fixes.map(([command]) => command.length));
  for (const [command, note] of fixes) {
    lines.push(`  ${command.padEnd(width)}  # ${note}`);
  }

  console.error(lines.map((line) => `ward: ${line}`).join("\n"));
}

/** `git config --unset` for the scope the value comes from; `null` for `git -c`. */
function unsetCommand(scope: string | null): string | null {
  switch (scope) {
    case "command":
      return null;
    case "global":
    case "system":
    case "worktree":
      return `git config --${scope} --unset core.hooksPath`;
    default:
      return "git config --unset core.hooksPath";
  }
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

export function toPosix(path: string): string {
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
