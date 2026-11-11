import { spawn } from "node:child_process";
import { constants } from "node:os";

export type ExecOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * Run a command through the system shell and return its exit code. Output
 * and stdin are the hook's own, so the command prints as it runs and can read
 * what git passes on stdin (`pre-push`).
 *
 * A command killed by a signal returns `128 + signal number`, as shells do.
 * A command that is not found is the shell's exit code (127 in `sh`).
 *
 * @throws when the shell itself can't be started.
 */
export function execCommand(
  command: string,
  { cwd, env = process.env }: ExecOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: "inherit" });

    // Ctrl+C goes to the whole process group, so the command gets it too:
    // wait for it to finish instead of dying first. SIGTERM goes to Ward
    // only, so it is passed on.
    const onSigint = () => undefined;
    const onSigterm = () => child.kill("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };

    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code, signal) => {
      cleanup();
      resolve(code ?? 128 + (signal ? constants.signals[signal] : 0));
    });
  });
}
