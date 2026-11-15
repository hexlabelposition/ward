import type { Hook, Task } from "../config/schema.ts";
import {
  getAllFiles,
  getPushFiles,
  getStagedFiles,
  parsePushInput,
} from "../git/files.ts";
import type { GitOptions } from "../git/exec.ts";
import type { HookName } from "../hooks/list.ts";
import {
  DEFAULT_FILE_SOURCE,
  expandCommand,
  type FileSource,
  fileSources,
} from "./command.ts";
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
 * task's `glob` / `exclude`. A task whose placeholders get no files is
 * skipped, so `eslint {staged_files}` never runs on the whole project. A task
 * with `glob` / `exclude` and no placeholder is matched against the hook's
 * files (`DEFAULT_FILE_SOURCE`) and skipped when none match.
 *
 * Each source is read from git once per run, when a task first needs it.
 * Push files come from the `pre-push` refs on stdin, so every task then gets
 * a copy of it on its own stdin.
 */
export async function runHook({
  hook,
  tasks,
  args = [],
  root,
  env = process.env,
  readStdin = readProcessStdin,
}: RunHookOptions): Promise<number> {
  const sources = new Set(tasks.flatMap((task) => taskSources(task, hook)));
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
    for (const source of taskSources(task, hook)) {
      files[source] = matchFiles(filesOf(source), task);
    }
    const lists = Object.values(files);
    if (lists.length > 0 && lists.every((list) => list.length === 0)) continue;

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

/**
 * Sources a task's files come from: its placeholders, else the hook's files
 * when it has `glob` / `exclude`. None means it always runs.
 */
function taskSources(task: Task, hook: HookName): FileSource[] {
  const sources = [...fileSources(task.run)];
  if (sources.length > 0) return sources;
  const fallback = DEFAULT_FILE_SOURCE[hook];
  const filtered = task.glob !== undefined || task.exclude !== undefined;
  return filtered && fallback !== undefined ? [fallback] : [];
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
