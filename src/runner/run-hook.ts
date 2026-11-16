import type { Hook, Task } from "../config/schema.ts";
import {
  getAllFiles,
  getPushFiles,
  getStagedFiles,
  type GitFile,
  parsePushInput,
} from "../git/files.ts";
import { addFiles } from "../git/add.ts";
import type { GitOptions } from "../git/exec.ts";
import type { HookName } from "../hooks/list.ts";
import {
  DEFAULT_FILE_SOURCE,
  expandCommandChunks,
  type FileSource,
  fileSources,
} from "./command.ts";
import { execCommand, execFunction } from "./exec.ts";
import { changedFiles, type Snapshot, snapshotFiles } from "./fixed.ts";
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
 * task's `glob` / `exclude`. Symlinks are left out unless the task sets
 * `symlinks: true`: a formatter would write through the link. A task whose placeholders get no files is
 * skipped, so `eslint {staged_files}` never runs on the whole project. A task
 * with `glob` / `exclude` and no placeholder is matched against the hook's
 * files (`DEFAULT_FILE_SOURCE`) and skipped when none match.
 *
 * A function task (`run: fn`) is called in-process with the hook's files that
 * match its `glob` / `exclude` and the hook's arguments. Like a command
 * without placeholders, it is skipped only when it has `glob` / `exclude`
 * and no file matches.
 *
 * Staged files a task changes (a formatter's fixes) are `git add`ed right
 * after it passes, unless it sets `stageFixed: false`; a task that fails
 * leaves its changes unstaged. Only the task's own staged files are
 * compared, so files with unstaged changes it did not touch stay as they are.
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
  const cache = new Map<FileSource, readonly GitFile[]>();
  const filesOf = (source: FileSource): readonly GitFile[] => {
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
      const paths = filesOf(source)
        .filter((file) => task.symlinks === true || !file.symlink)
        .map((file) => file.path);
      files[source] = matchFiles(paths, task);
    }
    const lists = Object.values(files);
    const always = typeof task.run === "function" && !isFiltered(task);
    if (!always && lists.length > 0 && lists.every((list) => !list.length)) {
      continue;
    }

    const before: Snapshot | undefined =
      task.stageFixed !== false && files.staged !== undefined
        ? snapshotFiles(root, files.staged)
        : undefined;

    let code = 0;
    if (typeof task.run === "function") {
      const [list = []] = lists;
      code = await execFunction(
        task.run,
        { files: [...list], args: [...args] },
        root,
      );
    } else {
      // Long file lists run as several commands, one after another.
      for (const command of expandCommandChunks(task.run, { args, files })) {
        code = await execCommand(command, { cwd: root, env, input });
        if (code !== 0) break;
      }
    }
    if (code !== 0) {
      console.error(
        `ward: ${hook} failed: ${task.name} (exit ${String(code)})`,
      );
      return code;
    }
    if (before !== undefined) {
      const fixed = changedFiles(root, before);
      if (fixed.length > 0) addFiles(fixed, git);
    }
  }
  return 0;
}

/**
 * Sources a task's files come from: its placeholders, else the hook's files
 * when it has `glob` / `exclude` or is a function. None means it always runs.
 */
function taskSources(task: Task, hook: HookName): FileSource[] {
  if (typeof task.run === "string") {
    const sources = [...fileSources(task.run)];
    if (sources.length > 0) return sources;
  }
  const fallback = DEFAULT_FILE_SOURCE[hook];
  const wanted = typeof task.run === "function" || isFiltered(task);
  return wanted && fallback !== undefined ? [fallback] : [];
}

function isFiltered(task: Task): boolean {
  return task.glob !== undefined || task.exclude !== undefined;
}

function listFiles(
  source: FileSource,
  git: GitOptions,
  args: readonly string[],
  input: string,
): readonly GitFile[] {
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
