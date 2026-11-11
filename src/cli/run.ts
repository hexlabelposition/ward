import { readConfig } from "../config/read.ts";
import { getRepoPaths, type RepoPaths } from "../git/paths.ts";
import { isHookName } from "../hooks/list.ts";
import { isErrnoCode } from "../util/errors.ts";

export type RunOptions = {
  /** Hook name, as the stub passes it. */
  hook: string | undefined;
  /** Arguments git passed to the hook. */
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * `ward run <hook> [args]`, called by the stubs. Returns the exit code.
 *
 * A hook with no tasks (no config, or the hook is not in it) exits 0 without
 * output: every hook has a stub, so this is the common case.
 */
export async function run({
  hook,
  cwd = process.cwd(),
  env = process.env,
}: RunOptions): Promise<number> {
  if (hook === undefined) {
    console.error("ward run: missing hook name, e.g. `ward run pre-commit`");
    return 1;
  }
  if (!isHookName(hook)) {
    console.error(`ward run: unknown hook "${hook}"`);
    return 1;
  }

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

  const config = await readConfig(paths.root);
  const tasks = config?.hooks[hook]?.tasks ?? [];
  if (tasks.length === 0) return 0;

  // Placeholder until tasks run (W16): don't block git meanwhile.
  console.warn(
    `ward: ${hook} has ${String(tasks.length)} tasks, but running tasks is not implemented yet`,
  );
  return 0;
}
