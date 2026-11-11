import type { Hook } from "../config/schema.ts";
import type { HookName } from "../hooks/list.ts";
import { execCommand } from "./exec.ts";

export type RunHookOptions = {
  hook: HookName;
  tasks: Hook["tasks"];
  /** Repo root: the working directory of every task. */
  root: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * Run the tasks of one hook in config order. Stops at the first task that
 * fails and returns its exit code, so git sees the same status the command
 * gave; 0 when all passed.
 */
export async function runHook({
  hook,
  tasks,
  root,
  env = process.env,
}: RunHookOptions): Promise<number> {
  for (const task of tasks) {
    const code = await execCommand(task.run, { cwd: root, env });
    if (code !== 0) {
      console.error(
        `ward: ${hook} failed: ${task.name} (exit ${String(code)})`,
      );
      return code;
    }
  }
  return 0;
}
