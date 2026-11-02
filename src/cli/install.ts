import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { getRepoPaths } from "../git/paths.ts";
import { installHooks } from "../hooks/install.ts";

const BIN = join("node_modules", ".bin", "ward");

/** `ward` with no arguments, run from `"prepare": "ward"`. Returns the exit code. */
export function install(cwd = process.cwd()): number {
  const paths = getRepoPaths({ cwd });
  if (!paths) {
    // W10 turns this into a silent no-op.
    console.error("ward: not inside a git working tree, hooks not installed");
    return 1;
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
