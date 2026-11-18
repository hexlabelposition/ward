import type { Hook, Task } from "../config/schema.ts";
import {
  getAllFiles,
  getPushFiles,
  getStagedFiles,
  type GitFile,
  hasStagedChanges,
  parsePushInput,
} from "../git/files.ts";
import { addFiles } from "../git/add.ts";
import {
  createBackup,
  discardHiddenChanges,
  dropBackup,
  type HiddenChanges,
  hideUnstagedChanges,
  RestoreError,
  restoreUnstagedChanges,
  revertToBackup,
} from "../git/backup.ts";
import type { GitOptions } from "../git/exec.ts";
import type { HookName } from "../hooks/list.ts";
import {
  DEFAULT_FILE_SOURCE,
  expandCommandChunks,
  type FileSource,
  fileSources,
} from "./command.ts";
import { execCommand, execFunction, type Prefixes } from "./exec.ts";
import { changedFiles, type Snapshot, snapshotFiles } from "./fixed.ts";
import { colorEnv, taskPrefixes } from "./output.ts";
import { matchFiles } from "./match.ts";

export type RunHookOptions = {
  hook: HookName;
  tasks: Hook["tasks"];
  /** Arguments git passed to the hook, for `{1}`, `{2}`. */
  args?: readonly string[];
  /** Repo root: the working directory of every task. */
  root: string;
  env?: NodeJS.ProcessEnv;
  /** Run all tasks at once instead of one after another. */
  parallel?: boolean;
  /** The hook's stdin, read in full. Defaults to `process.stdin`. */
  readStdin?: () => Promise<string>;
  /** Save the index and working tree before the first task. On by default. */
  backup?: boolean;
  /** Go back to the backup when the hook fails. On by default. */
  revert?: boolean;
};

/**
 * Run the tasks of one hook in config order. Stops at the first task that
 * fails and returns its exit code, so git sees the same status the command
 * gave; 0 when all passed.
 *
 * With `parallel`, all tasks start at once and every one runs to the end;
 * each failure is reported, and the exit code is that of the first failed
 * task in config order. Their output is written line by line, each line
 * prefixed with the task's name.
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
 * When a task gets staged files, the unstaged changes of partially staged
 * files are hidden while the tasks run: they see, fix and stage only what is
 * committed. The changes are put back afterwards, whether the tasks passed
 * or not; if they conflict with a task's fixes, the files are left with
 * conflict markers and the hook fails.
 *
 * Each source is read from git once per run, when a task first needs it.
 * Push files come from the `pre-push` refs on stdin, so every task then gets
 * a copy of it on its own stdin.
 *
 * Before the first task, the index and the tracked files of the working tree
 * are saved with `git stash create` as "ward backup" in `git stash list`
 * (unless `backup: false`). When the hook fails (a task failed, or the
 * unstaged changes conflict with its fixes), the index and working tree are
 * reverted to it, unless `revert: false`. The entry is dropped when the hook
 * passes or the revert worked; otherwise it is kept and its hash printed, so
 * the state before the run can be restored by hand.
 *
 * In `pre-commit`, a run that leaves nothing to commit fails: the staged
 * changes were there before the tasks and their fixes undid all of them
 * (a formatter reverting a whitespace-only change), so git would make an
 * empty commit. An index that already matched `HEAD` before the run
 * (`git commit --allow-empty`) is let through.
 *
 * Without a revert (no backup, or `revert: false`), task changes stay; hidden
 * unstaged changes are put back on top of them, and a conflict leaves
 * conflict markers in the files.
 */
export async function runHook({
  hook,
  tasks,
  args = [],
  root,
  env = process.env,
  parallel = false,
  readStdin = readProcessStdin,
  backup = true,
  revert = true,
}: RunHookOptions): Promise<number> {
  const sources = new Set(tasks.flatMap((task) => taskSources(task, hook)));
  // Read before the first task: a task could otherwise consume it. Parallel
  // tasks can't share it either, so each gets a copy.
  const input = sources.has("push") || parallel ? await readStdin() : undefined;

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

  /**
   * Read the task's files and snapshot them, then return a function that
   * runs it; `null` when it is skipped.
   */
  const prepare = (
    task: Task,
    prefix?: Prefixes,
  ): (() => Promise<number>) | null => {
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
      return null;
    }

    const before: Snapshot | undefined =
      task.stageFixed !== false && files.staged !== undefined
        ? snapshotFiles(root, files.staged)
        : undefined;

    return async () => {
      let code = 0;
      if (typeof task.run === "function") {
        const [list = []] = lists;
        code = await execFunction(
          task.run,
          { files: [...list], args: [...args] },
          root,
          prefix?.stderr,
        );
      } else {
        // Long file lists run as several commands, one after another.
        for (const command of expandCommandChunks(task.run, { args, files })) {
          code = await execCommand(command, {
            cwd: root,
            env: prefix ? colorEnv(env) : env,
            input,
            prefix,
          });
          if (code !== 0) break;
        }
      }
      if (code !== 0) {
        console.error(
          `ward: ${hook} failed: ${task.name} (exit ${String(code)})`,
        );
        return code;
      }
      // Synchronous, so parallel tasks never run `git add` at the same time.
      if (before !== undefined) {
        const fixed = changedFiles(root, before);
        if (fixed.length > 0) addFiles(fixed, git);
      }
      return 0;
    };
  };

  const runTasks = async (): Promise<number> => {
    if (parallel) {
      // Every task is prepared before the first one starts, so none of them
      // sees files another task already changed.
      // Output is prefixed with the task's name, so it is clear what printed
      // what while they run together.
      const names = tasks.map((task) => task.name);
      const jobs = tasks.map((task, i) =>
        prepare(task, taskPrefixes(names, i)),
      );
      const codes = await Promise.all(
        jobs.map((job) => (job ? job() : Promise.resolve(0))),
      );
      return codes.find((code) => code !== 0) ?? 0;
    }
    for (const task of tasks) {
      const code = (await prepare(task)?.()) ?? 0;
      if (code !== 0) return code;
    }
    return 0;
  };

  // Read before anything else touches the index.
  const stagedBefore = hook === "pre-commit" && hasStagedChanges(git);
  const hash = backup ? createBackup(git) : null;
  // Without a backup there is nothing to revert to.
  const reverting = hash !== null && revert;
  const keep = (hash: string) => {
    console.error(
      `ward: the index and working tree before the run are kept as "ward backup" in \`git stash list\` (${hash})`,
    );
  };
  // Tasks that get staged files see only what is committed.
  const hidden = sources.has("staged")
    ? hideUnstagedChanges(
        filesOf("staged").map((file) => file.path),
        git,
      )
    : null;

  let code: number;
  try {
    code = await runTasks();
  } catch (error) {
    // Not a failed task but a failure of Ward or git: put the unstaged
    // changes back and keep the backup, without reverting.
    if (hidden !== null) restore(hidden, git, false);
    if (hash !== null) keep(hash);
    throw error;
  }

  // The index is final here: putting back unstaged changes doesn't touch it.
  if (code === 0 && stagedBefore && !hasStagedChanges(git)) {
    console.error(
      `ward: ${hook} failed: the tasks undid every staged change, so the commit would be empty (\`git commit --no-verify\` commits anyway)`,
    );
    code = 1;
  }

  if (hidden !== null) {
    if (code !== 0 && reverting) {
      // The revert brings them back with everything else.
      discardHiddenChanges(hidden);
    } else if (!restore(hidden, git, reverting)) {
      if (code === 0) code = 1;
      // The revert writes over the conflict markers.
      if (reverting) discardHiddenChanges(hidden);
    }
  }

  if (hash === null) return code;
  if (code === 0) {
    dropBackup(hash, git);
  } else if (reverting) {
    try {
      revertToBackup(hash, git);
    } catch (error) {
      keep(hash);
      throw error;
    }
    dropBackup(hash, git);
    console.error(
      "ward: reverted the index and working tree to the state before the run (`--no-revert` keeps the changes of the tasks)",
    );
  } else {
    keep(hash);
  }
  return code;
}

/**
 * Put hidden unstaged changes back; `false` (reported) when they could not
 * be restored cleanly.
 *
 * @param reverting A revert follows, so the user has nothing to resolve.
 */
function restore(
  hidden: HiddenChanges,
  git: GitOptions,
  reverting: boolean,
): boolean {
  try {
    restoreUnstagedChanges(hidden, git);
    return true;
  } catch (error) {
    if (!(error instanceof RestoreError)) throw error;
    reportRestoreError(error, reverting);
    return false;
  }
}

function reportRestoreError(error: RestoreError, reverting: boolean): void {
  if (reverting) {
    const files =
      error.conflicts.length > 0 ? ` in ${error.conflicts.join(", ")}` : "";
    console.error(
      `ward: unstaged changes could not be put back on top of task fixes${files}`,
    );
  } else if (error.conflicts.length > 0) {
    console.error(
      `ward: unstaged changes conflict with task fixes in ${error.conflicts.join(", ")}: resolve the conflicts (text files have conflict markers, binary files keep the tasks' version). The unstaged changes are also kept in ${error.patch}`,
    );
  } else {
    console.error(
      `ward: could not restore unstaged changes: ${error.message}\nThey are kept in ${error.patch}`,
    );
  }
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
