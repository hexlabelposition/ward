import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:os";
import type { TaskContext, TaskFunction } from "../config/define.ts";
import { prefixLines } from "./output.ts";

/** Put before each line of a task's output (parallel mode). */
export type Prefixes = { stdout: string; stderr: string };

export type ExecOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Written to the command's stdin instead of passing the hook's own: for
   * when Ward has already read it (`pre-push` refs for `{push_files}`).
   */
  input?: string | undefined;
  /**
   * Pipe the command's output and write it line by line with these
   * prefixes, instead of letting it write to the hook's output directly.
   */
  prefix?: Prefixes | undefined;
};

/** Commands running now, for the signal handlers below. */
const running = new Set<ChildProcess>();

// Ctrl+C goes to the whole process group, so the commands get it too: wait
// for them to finish instead of dying first. SIGTERM goes to Ward only, so
// it is passed on. One pair of handlers for all commands, so parallel tasks
// don't pile up listeners.
const onSigint = () => undefined;
const onSigterm = () => {
  for (const child of running) child.kill("SIGTERM");
};

/** Track a running command; returns the function that stops tracking it. */
function trackChild(child: ChildProcess): () => void {
  if (running.size === 0) {
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  }
  running.add(child);
  return () => {
    if (!running.delete(child) || running.size > 0) return;
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
}

/**
 * Run a command through the system shell and return its exit code. Output
 * and stdin are the hook's own, so the command prints as it runs and can read
 * what git passes on stdin (`pre-push`); with `input`, stdin is that text.
 *
 * With `prefix`, output goes through Ward instead, one whole line at a time.
 *
 * A command killed by a signal returns `128 + signal number`, as shells do.
 * A command that is not found is the shell's exit code (127 in `sh`).
 *
 * @throws when the shell itself can't be started.
 */
export function execCommand(
  command: string,
  { cwd, env = process.env, input, prefix }: ExecOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const output = prefix === undefined ? "inherit" : "pipe";
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: [input === undefined ? "inherit" : "pipe", output, output],
    });
    const out =
      prefix &&
      prefixLines(prefix.stdout, (text) => process.stdout.write(text));
    const err =
      prefix &&
      prefixLines(prefix.stderr, (text) => process.stderr.write(text));
    if (out && err) {
      child.stdout?.on("data", out.write);
      child.stderr?.on("data", err.write);
    }
    if (input !== undefined) {
      // A command that exits without reading stdin closes the pipe: EPIPE.
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(input);
    }

    const cleanup = trackChild(child);

    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code, signal) => {
      cleanup();
      // All output has arrived by now: write the lines left without "\n".
      out?.end();
      err?.end();
      resolve(code ?? 128 + (signal ? constants.signals[signal] : 0));
    });
  });
}

/**
 * Call a function task from `cwd` and return 0, or print what it threw and
 * return 1, each line after `prefix` when given. What the function itself
 * prints is not prefixed: it shares Ward's output. Ward's working directory stays `cwd` afterwards: relative paths
 * in `context.files` keep working in callbacks the function leaves behind.
 */
export async function execFunction(
  run: TaskFunction,
  context: TaskContext,
  cwd: string,
  prefix?: string,
): Promise<number> {
  try {
    process.chdir(cwd);
    await run(context);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (prefix === undefined) {
      console.error(message);
    } else {
      const lines = prefixLines(prefix, (text) => process.stderr.write(text));
      lines.write(`${message}\n`);
    }
    return 1;
  }
}
