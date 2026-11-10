import { readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { getRepoPaths, type RepoPaths } from "../git/paths.ts";
import { uninstallHooks } from "../hooks/install.ts";
import { CHAINED_SUFFIX } from "../hooks/stub.ts";
import { isErrnoCode } from "../util/errors.ts";
import { toPosix } from "./install.ts";

export type UninstallOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * `ward uninstall`: remove ward stubs and restore chained hooks. Returns the
 * exit code. Unlike install it is never a silent no-op: it was asked for.
 *
 * Cleans the dir git runs hooks from and `.git/hooks`: stubs may be left there
 * when `core.hooksPath` was set after install.
 */
export function uninstall({
  cwd = process.cwd(),
  env = process.env,
}: UninstallOptions = {}): number {
  let paths: RepoPaths | null;
  try {
    paths = getRepoPaths({ cwd, env });
  } catch (error) {
    if (!isErrnoCode(error, "ENOENT")) throw error;
    console.error("ward: git not found");
    return 1;
  }
  if (!paths) {
    console.error("ward: not inside a git working tree");
    return 1;
  }

  const { root, hooksDir, commonDir } = paths;
  const dirs = [...new Set([hooksDir, join(commonDir, "hooks")])];
  let found = false;

  for (const dir of dirs) {
    const where = display(root, dir);
    const result = uninstallHooks(dir);

    for (const hook of result.restored) {
      console.log(`ward: restored ${hook} from ${hook}${CHAINED_SUFFIX}`);
    }
    for (const hook of result.backupKept) {
      console.warn(
        `ward: ${hook}${CHAINED_SUFFIX} left in ${where}: ${hook} is taken by a hook not installed by ward. ` +
          "Keep one of them by hand.",
      );
    }
    if (result.removed.length > 0) {
      console.log(
        `ward: removed ${String(result.removed.length)} hooks from ${where}`,
      );
    }
    found ||= result.removed.length + result.restored.length > 0;
  }

  if (!found) {
    console.log(`ward: no ward hooks found in ${display(root, hooksDir)}`);
    return 0;
  }
  if (hasPrepare(root)) {
    console.log(
      'ward: package.json still runs ward in "prepare": the next install puts the hooks back',
    );
  }
  return 0;
}

function display(root: string, dir: string): string {
  const rel = relative(root, dir);
  return rel.startsWith("..") || isAbsolute(rel) ? dir : toPosix(rel);
}

/** `"prepare"` in the root package.json calls ward. */
function hasPrepare(root: string): boolean {
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts?: { prepare?: unknown } };
    const prepare = pkg.scripts?.prepare;
    return typeof prepare === "string" && /(^|[\s/])ward(\s|$)/.test(prepare);
  } catch {
    return false;
  }
}
