import type { Hook } from "../config/schema.ts";
import {
  getAllFiles,
  getPushFiles,
  getStagedFiles,
  parsePushInput,
} from "../git/files.ts";
import type { GitOptions } from "../git/exec.ts";
import type { HookName } from "../hooks/list.ts";
import { expandCommand, type FileSource, fileSources } from "./command.ts";
import { execCommand } from "./exec.ts";
import { matchFiles } from "./match.ts";

export type RunHookOptions = {
  hook: HookName;
  tasks: Hook["tasks"];
  /** Arguments git passed to the hook, for `{1}`, `{2}`. */
  args?: readonly string[];
  /** Repo root: the working directory of every task. */
  root: string;
  env?: NodeJS.ProcessEnv;
  /** The hook's stdin, read in full. Defaults to `process.stdin`. */
  readStdin?: () => Promise<string>;
};

/**
 * Run the tasks of one hook in config order. Stops at the first task that
 * fails and returns its exit code, so git sees the same status the command
 * gave; 0 when all passed.
 *
 * File placeholders expand to the files of their source that match the
 * task's `glob` / `exclude`. Each source is read from git once per run, when
 * a task first needs it. `{push_files}` reads the `pre-push` refs from stdin,
 * so every task then gets a copy of it on its own stdin.
 */
export async function runHook({
  hook,
  tasks,
  args = [],
  root,
  env = process.env,
  readStdin = readProcessStdin,
}: RunHookOptions): Promise<number> {
  const sources = new Set(tasks.flatMap((task) => [...fileSources(task.run)]));
  // Read before the first task: a task could otherwise consume it.
  const input = sources.has("push") ? await readStdin() : undefined;

  const git: GitOptions = { cwd: root, env };
  const cache = new Map<FileSource, readonly string[]>();
  const filesOf = (source: FileSource): readonly string[] => {
    let files = cache.get(source);
    if (files === undefined) {
      files = listFiles(source, git, args, input ?? "");
      cache.set(source, files);
    }
    return files;
  };

  for (const task of tasks) {
    const files: Partial<Record<FileSource, readonly string[]>> = {};
    for (const source of fileSources(task.run)) {
      files[source] = matchFiles(filesOf(source), task);
    }

    const code = await execCommand(expandCommand(task.run, { args, files }), {
      cwd: root,
      env,
      input,
    });
    if (code !== 0) {
      console.error(
        `ward: ${hook} failed: ${task.name} (exit ${String(code)})`,
      );
      return code;
    }
  }
  return 0;
}

function listFiles(
  source: FileSource,
  git: GitOptions,
  args: readonly string[],
  input: string,
): readonly string[] {
  switch (source) {
    case "staged":
      return getStagedFiles(git);
    case "all":
      return getAllFiles(git);
    case "push":
      // `pre-push <remote name or URL> <URL>`; the schema allows
      // `{push_files}` in `pre-push` only.
      return getPushFiles(parsePushInput(input), args[0] ?? "", git);
  }
}

/** All of stdin; empty when it is a terminal (`ward run` typed by hand). */
async function readProcessStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
