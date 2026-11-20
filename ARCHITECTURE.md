# Architecture

## Goals

1. One package replaces husky + lint-staged.
2. The only file in the repo is the config (`ward.config.ts` / `ward.yml` / `package.json` section).
3. Config changes apply without reinstalling.
4. Fast no-op when a hook has nothing to do.
5. Never lose user changes (partial staging, existing hooks).
6. The same config runs locally and in CI.
7. Few dependencies, small package.

## High-level flow

```bash
npm install
   └─ "prepare": ward
         └─ writes stubs → .git/hooks/<every-hook>

git commit
   └─ .git/hooks/pre-commit (stub)
         └─ ward run pre-commit "$@"
               ├─ merge / rebase in progress? → exit 0
               ├─ load config (fresh, every time)
               ├─ no tasks for hook? → exit 0
               ├─ collect files (staged / push / all / --from-ref)
               ├─ back up state (unless --no-backup)
               ├─ hide unstaged changes of partially staged files
               ├─ run tasks (graph order, parallel where possible, cache)
               ├─ git add files fixed by tasks (stageFixed)
               ├─ restore unstaged changes
               ├─ failure? → revert from backup (unless --no-revert)
               ├─ print report
               └─ exit with task status
```

## Modules

```text
src/
├─ cli/            # argument parsing, commands: (default) install, init, run, doctor, migrate, uninstall
├─ config/
│  ├─ discover.ts  # find ward.config.ts → ward.{yml,yaml} → package.json; error on several
│  ├─ load.ts      # pick the loader by format, imported lazily
│  ├─ load-ts.ts   # native import() with Node type stripping
│  ├─ load-yml.ts  # load YAML (yaml package)
│  ├─ load-pkg.ts  # "ward" section of package.json
│  ├─ local.ts     # merge ward.local.*
│  ├─ extends.ts   # resolve extends: built-in presets, local paths, npm packages
│  ├─ schema.ts    # validation + normalization to internal model
│  └─ define.ts    # defineConfig() + public types
├─ git/
│  ├─ exec.ts      # thin wrapper around `git` child process
│  ├─ paths.ts     # git rev-parse --git-path hooks, repo root
│  ├─ files.ts     # staged / push / all / from-ref file lists
│  ├─ state.ts     # merge / rebase in progress detection
│  └─ backup.ts    # backup, partial-staging hide/restore, revert
├─ hooks/
│  ├─ list.ts      # all supported git hook names
│  ├─ stub.ts      # stub template + marker
│  └─ install.ts   # write/remove stubs, detect foreign hooks
├─ runner/
│  ├─ match.ts     # glob / exclude → files (picomatch), symlink filter
│  ├─ command.ts   # placeholder expansion, chunking long arg lists
│  ├─ exec.ts      # spawn commands / call function tasks, stream output
│  ├─ output.ts    # line prefixes for parallel output
│  ├─ fixed.ts     # find files changed by a task (stageFixed)
│  ├─ graph.ts     # dependsOn ordering, root / affected packages
│  ├─ cache.ts     # per-task file hash cache
│  └─ run-hook.ts  # orchestrates one hook run
├─ report/
│  ├─ summary.ts   # timings, failure reason, fix hint
│  └─ github.ts    # GitHub Actions annotations
├─ runtime/
│  └─ detect.ts    # Node / Bun / Deno detection, runtime-specific bits
├─ presets/        # built-in presets, exported as @hexlabelposition/ward/presets
├─ doctor/         # hooksPath conflicts, foreign hook leftovers
├─ migrate/        # husky + lint-staged, lefthook, simple-git-hooks
└─ index.ts        # public API: defineConfig, types
```

## Key decisions

### Runtimes

Ward is a JS package that runs on Node ≥ 24 (`engines.node: ">=24"`), Bun ≥ 1.1 and Deno ≥ 2. All three load `.ts` natively, so `ward.config.ts` needs no loader dependency. A Go binary is not planned for now.

The code targets the Node API surface that Bun and Deno implement, so one build runs everywhere. Runtime-specific behavior is isolated in `runtime/` (detect via `process.versions.bun` / `process.versions.deno`):

- **TS config:** native `import()` everywhere. Node only strips types (erasable syntax); Bun and Deno accept full TS.
- **Stub:** generated for the runtime that ran install; `WARD_RUNTIME` overrides it at run time.
- **Install on Bun:** `bun install` runs the `prepare` script of the root and of workspace packages, same as npm. It starts `ward` through the `node` shebang, so with Node installed the stubs are Node stubs; without Node, Bun puts its own `node` first in PATH and the stubs are Bun stubs. `init` detects `bun.lock` / `bun.lockb`.
- **Install on Deno:** there is no `prepare` lifecycle (`deno install` runs neither a `deno.json` task nor the `package.json` `prepare`, even with `--allow-scripts`) and no `node_modules/.bin` by default. So the stub calls `deno run -A npm:@hexlabelposition/ward`, the user runs `deno task prepare` once per clone, and `init` adds that `deno.json` task. Install hints show the same command instead of `npx ward`. `init` detects `deno.json` / `deno.lock`.

### No `.ward/` folder - stubs in `.git/hooks`

`.git/hooks` is not committed, so each clone generates its own stubs via `prepare`. Repo stays clean: only the config is versioned.

The hooks directory is resolved with `git rev-parse --git-path hooks` - never hardcoded - so worktrees and submodules work.

### Stubs for all hooks → dynamic config

`ward` (no arguments, run from `prepare`) writes a stub for **every** supported git hook, not just the ones in the config. The stub has no logic:

```sh
#!/bin/sh
# ward:managed v2
bin=node_modules/.bin/ward        # git runs hooks from the repo root
[ "$WARD" = "0" ] && exit 0       # after a chained hook, if there is one
runtime=${WARD_RUNTIME:-node}     # default = runtime that ran install
[ "$runtime" = deno ] && exec deno run -A npm:@hexlabelposition/ward run pre-commit "$@"
[ -f "$bin" ] || { echo "ward: $bin not found, skipping" >&2; exit 0; }
[ "$runtime" = bun ] && exec bun "$bin" run pre-commit "$@"
exec "$bin" run pre-commit "$@"
```

Because the config is read on every run, adding/removing hooks in the config needs no reinstall. When the stub format or the active-hooks cache gets out of date (new Ward version, config changed), `ward run` rewrites the stubs itself, so users never have to reinstall by hand.

- `# ward:managed v2` - marker used by `uninstall` and for upgrade detection.
- Calls the local binary directly, not `npx` / `bunx` (much faster startup). The path is relative: git runs hooks from the root of the working tree, so no `git rev-parse` is needed.
- Missing binary (dependencies not installed yet) → warning and exit 0, so git is not blocked.
- Each clone writes its own stubs, so team members on different runtimes don't conflict.
- Bun is started explicitly (`bun "$bin"`): the binary's shebang names `node`, which may not be installed.
- Deno has no `node_modules/.bin` by default, so its stub runs `npm:@hexlabelposition/ward` and skips the binary check. Deno takes the version from `deno.json` imports or `package.json` and the lockfile; without either it runs the latest version.
- An unknown `WARD_RUNTIME` or a missing `bun` / `deno` fails the hook with a hint instead of skipping: the runtime was asked for, so skipping would hide the problem.

### Fast no-op path

Most hooks (e.g. `post-checkout`) will usually be empty. `run` must:

1. Find config file (no heavy imports yet).
2. Load config.
3. If the hook is absent → `exit 0` before loading runner, git, glob modules.

Lazy `import()` keeps cold start minimal.

**Later optimization:** `.git/ward-hooks.json` holds the list of active hooks; the stub checks it in shell and exits without starting Node. Invalidated by config mtime.

### Merge and rebase

If `MERGE_HEAD`, `rebase-merge/` or `rebase-apply/` exists in the git dir, `ward run` exits 0 without running tasks. Commits created by git during a merge or rebase are not the user's working changes. The check uses the git dir of the worktree, so a merge in one worktree does not affect another. `rebase-apply/` also covers `git am`. The config is not read, so even an invalid one does not block the merge.

### Config loading

| File                | Loader                                |
| ------------------- | ------------------------------------- |
| `ward.config.ts`    | native `import()` (Node / Bun / Deno) |
| `ward.yml`, `.yaml` | `yaml`                                |
| `package.json`      | `JSON.parse`, `"ward"` key            |

Loaders return raw data; validation and normalization come after. A TS config must have a default export; syntax Node can't strip (`enum`, `namespace`, parameter properties) fails with the line and a hint. An empty `ward.yml` is an empty config; duplicate keys and several YAML documents are errors.

Discovery order: `ward.config.ts` → `ward.yml` / `ward.yaml` → `package.json`. If several sources exist → error, not a silent pick. Only the repo root is searched, never parent or package dirs: one config per repo. `package.json` counts only when it has a `"ward"` key. No config means no tasks: every hook is a no-op. `ward run` validates the whole config, not only the hook it runs, so an invalid config fails every hook: a typo like `pre-comit` would otherwise go unnoticed.

Merge order: `extends` packages (in listed order) → repo config → `ward.local.*`.

Function tasks and the task graph (`dependsOn`, `root`) are only available in the TS config; YAML and `package.json` hold plain data. The docs must say this explicitly.

`defineConfig` gives types and autocomplete; `schema.ts` validates every source at load time with clear errors (unknown hook, unknown option, bad glob). It lists every problem with its path in the config (`hooks.pre-push[1]`) and suggests close names; options from later versions fail as "not supported yet" instead of being ignored. A JSON Schema covers YAML and `package.json`.

All forms are normalized to one internal model (`schema.ts`; fields arrive with their features). The string and array forms become tasks named after their command:

```ts
type Hook = {
  tasks: Task[]; // from string | string[] | { tasks: { name: task } }
  parallel: boolean;
  backup: boolean;
  revert: boolean;
};

type Task = {
  name: string;
  run: string | ((ctx: { files: string[]; args: string[] }) => unknown);
  glob?: string[];
  exclude?: string[];
  root?: string;
  tags: string[];
  stageFixed: boolean; // default true
  symlinks: boolean; // default false
  cache: boolean;
  dependsOn: string[];
};
```

### Presets and shared configs (`extends`)

`extends` is a list; entries are merged in order, then the repo config, then `ward.local.*`. Each entry is one of:

| Entry         | Resolved as                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ward:<name>` | Built-in preset from `src/presets/`                                                                                                 |
| Config object | Used as is (TS config: `import { ts } from "@hexlabelposition/ward/presets"`)                                                       |
| `./…`, `../…` | Local config file, relative to the config that lists it                                                                             |
| Package name  | npm package resolved from the repo root via `import.meta.resolve`; default export (config object) or `ward.yml` in the package root |

**Presets live in the main package**, not in separate `ward-preset-*` packages: a preset is a few lines of config, so it adds almost nothing to package size, needs no extra install, and its version always matches Ward's. The trade-off - a preset change needs a Ward release - is fine for presets.

**Shared company configs** can't ship with Ward, so they come from a local path or an npm package. npm is preferred over a git URL: the version is pinned by the lockfile, runs are offline, private configs use the usual registry auth, the same resolution works on Node, Bun and Deno (`npm:` specifiers), and nothing is downloaded and executed behind the lockfile's back. Git-hosted configs may come later, YAML only.

### File sources

| Source           | How                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{staged_files}` | `git diff --cached --name-only -z --diff-filter=ACMR`                                                                                                    |
| `{push_files}`   | files changed by the pushed commits (`pre-push` stdin): `git log <local> --not <remote sha> --remotes=<remote>`, minus files gone from the pushed commit |
| `{all_files}`    | `git ls-files -z`                                                                                                                                        |
| `--from-ref`     | `git diff --name-only -z <ref>...HEAD`                                                                                                                   |

Placeholders expand in one pass, so a file named `{1}.ts` is not expanded again. Each source is read from git once per run, when a task first uses it. `{push_files}` is only valid in `pre-push`: Ward reads the refs from stdin before the first task and gives every task a copy on its stdin.

A task's `glob` / `exclude` pick its files from the source (`runner/match.ts`, picomatch). A pattern without `/` matches the file name in any directory (`*.ts`), as in `.gitignore`; a pattern with `/` matches the path from the repo root (`src/**/*.ts`). Dotfiles match like other files. A task whose placeholders get no files is skipped, so `eslint {staged_files}` never runs on the whole project. A task with `glob` / `exclude` and no placeholder (`tsc`) runs only when a file of the hook matches: staged files in `pre-commit`, push files in `pre-push`; in other hooks it needs a placeholder (config error). Unbalanced brackets and patterns starting with `./` or `/` are config errors. picomatch is loaded only when the config has patterns.

Symlinks are dropped unless the task sets `symlinks: true`: a formatter would rewrite the file the link points to. A symlink is a file git stores with mode `120000` (staged, pushed or index mode, not `lstat`), so it works for files not on disk and on Windows without symlink support. Submodules (mode `160000`) are never passed to tasks.

### Fixed files (`stageFixed`)

Staged files a task changes (formatter fixes) are `git add`ed right after the task passes (`runner/fixed.ts`, `git/add.ts`), unless the task sets `stageFixed: false`. Ward hashes the task's staged files (after `glob` / `exclude`) before it runs and compares after, so only files the task touched are added: unstaged files and files from `{all_files}` / `{push_files}` that are not staged stay as they are. A file the task deletes is staged as deleted. A failed task leaves its changes unstaged. Paths go to `git --literal-pathspecs add` in chunks (git ≥ 2.20 has no `--pathspec-from-file`).

A file that also had unstaged changes is added without them: they are hidden while the tasks run (see "Partial staging and backup"). A file changed by a `stageFixed: false` task and then fixed by another task is added with both changes.

### Partial staging and backup (the hard part)

Problem: a file is partially staged; a formatter rewrites the whole file and you'd commit unstaged work or lose it.

Approach (same idea as lint-staged):

1. Save a backup: `git stash create` → keep the hash (does not touch the working tree). Always on; `--no-backup` / `backup: false` skips it for large repos.
2. Write a patch of unstaged changes for partially staged files: `git diff --binary`.
3. Check out the index version of those files: `git checkout-index` / `git restore --worktree`.
4. Run tasks.
5. `git add` files the tasks modified, except for tasks with `stageFixed: false`.
6. Re-apply the unstaged patch (`git apply --3way`).
7. On failure (a task failed, or the unstaged changes conflict with its fixes) → restore from backup hash and report. `--no-revert` / `revert: false` keeps task changes for inspection. Without a backup a full revert is not possible; only the unstaged patch is restored.

The backup (`git/backup.ts`) is taken before the first task of every hook that has tasks. The stash commit is also stored in `git stash list` as "ward backup", so it survives a killed run and can be restored by hand; it is dropped when the hook passes or a revert worked, and kept, with its hash printed, otherwise (`--no-revert`, a failed revert, an error in Ward or git). It is found by hash, not by position, since a task may push or pop stash entries. No changes or no commit yet (`git stash create` has nothing to base on) → no backup. Untracked files are not part of it. Inside `git commit -a` / `git commit <paths>` it records the index git passes in `GIT_INDEX_FILE`, the one being committed.

Partial staging (steps 2, 3, 6; `git/backup.ts`) runs only when a task gets staged files: `{staged_files}`, or a function task or `glob` / `exclude` without placeholders in `pre-commit`. A plain `npm test` sees the working tree as is. A partially staged file is a staged file (`ACMR`) with unstaged changes. The patch is written with fixed `a/` `b/` prefixes and no external diff or textconv, so user diff settings can't break it, and kept in `.git/ward/unstaged.patch` until it is applied, so a killed run leaves it recoverable. The unstaged changes are restored after the tasks, unless a revert follows (it brings them back with everything else):

- A plain `git apply` first: it works when the tasks didn't touch the lines around the unstaged changes.
- Otherwise `git apply --3way`. It applies to the index too, so it runs against a copy of the index (`GIT_INDEX_FILE`) where the files are added as the tasks left them; the real index keeps exactly what the tasks staged.
- Changes that overlap a fix (or are on the next line, as in any git merge) fail the hook and the message names the files. With a revert, the backup writes over the conflict. Without one, the files keep conflict markers and the patch is kept; the index holds the fixed staged version.

The revert (step 7, `revertToBackup`) writes back only the tracked files that differ from the backup (`git diff --name-status <backup>`, then `git checkout <backup> -- <files>`), so untouched files keep their timestamps, and resets the index to the stash's index commit with `git reset <backup>^2 -- .`, which rewrites only the entries that differ. A file the tasks added to the index leaves it but stays on disk; untracked files are not touched. An error in Ward or git itself (not a failed task) does not revert: the unstaged changes are put back and the backup is kept.

`--no-backup` and `--no-revert` are read only right after the hook name (`ward run pre-commit --no-backup`): the stubs pass git's hook arguments unparsed, so anything after the first other argument, or after `--`, goes to the hook.

Edge cases (`test/git/backup-edge.test.ts`):

- **Binary files** go through the patch (`--binary`) and the backup like text. When a task and the unstaged changes both change one, git can't merge it: without a revert the file keeps the task's version and the patch is kept.
- **Renames**: a staged rename is a staged file under its new path; its unstaged changes are hidden there. The old path is gone from the working tree and stays gone. The revert compares with `--no-renames`, so it sees the new path as changed and the old one as deleted, like the backup.
- **Deletions**: a file deleted and staged (`git rm`) is not a staged file and is left alone. A staged file deleted only in the working tree is checked out from the index so tasks can read and fix it, kept out of the patch, and deleted again after the tasks; a fix to it stays staged. The revert deletes it too: it is in the backup's index but not its working tree.
- **Merge in progress**: hooks are skipped during a merge or rebase (see "Merge and rebase"). A cherry-pick or revert that stopped on a conflict is not skipped: once the conflict is resolved and staged, the hook runs as usual, and the revert (path-limited `checkout` and `reset`, never `reset --hard`) leaves `CHERRY_PICK_HEAD` / `REVERT_HEAD` in place. While the index still has unresolved conflicts, `git stash create` fails, so there is no backup (and no revert) and conflicted files are never hidden; `git commit` refuses that state anyway, so this only happens with other hooks or `ward run` by hand.
- **Symlinks** and file ↔ symlink type changes go through the patch, `checkout-index` and the revert as git stores them. Tasks still don't get symlinks unless `symlinks: true`.
- **Non-ASCII paths**: every list is read with `-z` and paths are passed as arguments, so spaces, accents and newlines are kept as is.
- **Empty commit after formatting**: in `pre-commit`, Ward checks the index against `HEAD` (`git diff --cached --quiet`) before the run and after the tasks. If there were staged changes before and none are left (a formatter undid a whitespace-only change), git would make an empty commit, so the hook fails with a message that names `git commit --no-verify`, and the revert brings the staged change back. An index that already matched `HEAD` (`git commit --allow-empty`, `--amend` to reword) is not checked: git doesn't tell hooks about `--allow-empty`, so "nothing staged before the run" is the signal. Other hooks are not checked.

### Existing hooks

On install, if a hook file exists **without** the marker, Ward never overwrites it silently: users may not know the hook is there (git-lfs, an old husky setup, a hand-written script).

- Interactive (`npx ward` in a terminal: stdin and stdout are a TTY): Ward lists the hooks and asks whether to keep them. Yes → rename to `<hook>.pre-ward` and chain it from the stub.
- Non-interactive (`prepare` under most package managers, IDEs): the hook is left as is, Ward prints a warning with the command to chain it and exits 0, so `npm install` doesn't fail.
- `--chain`: chain without asking.
- `--force`: overwrite without asking; the old hook is lost. With `--chain`, only hooks that can't be chained (`<hook>.pre-ward` taken) are overwritten.

A chained hook runs first with the same arguments; if it fails, git stops and Ward does not run. Hooks that read stdin (`pre-push`, `post-rewrite`) get a copy of it, and so does Ward. An existing `<hook>.pre-ward` is never overwritten. Directories in place of a hook are left as is.

If `core.hooksPath` is set, git ignores `.git/hooks` → print a clear warning and exit non-zero (unless `--respect-hooks-path`, which installs there instead). The warning names the value and its config scope and gives the fix: the matching `git config [--global|--system|--worktree] --unset core.hooksPath`, or `--respect-hooks-path`. `--respect-hooks-path` only installs into a directory inside the working tree or the git dir: a directory outside (`~/.githooks`) is shared with other repos, and the working tree root would get a file per hook. `ward doctor` reports the same, plus leftovers from husky, lefthook and simple-git-hooks.

`ward uninstall` removes only files with the marker (a symlink is never one) and moves each `<hook>.pre-ward` back to `<hook>`, unless `<hook>` is taken by a foreign hook - then both are left and Ward warns. It cleans the dir git runs hooks from and `.git/hooks`, since stubs stay there when `core.hooksPath` is set after install. Unlike install it is not a no-op in CI or outside a repo: it was asked for, so it fails instead of skipping silently.

### Task execution

- Commands run through the system shell, cwd = repo root or the task's `root`.
- Function tasks are called in-process with `{ files, args }`: the hook's files (staged in `pre-commit`, pushed in `pre-push`, none elsewhere) that match `glob` / `exclude`, relative to the repo root, and the hook's arguments. Ward changes its working directory to the repo root first. A thrown error or rejected promise fails the task (exit 1, message printed); the return value is ignored. Like a command without placeholders, a function task is skipped only when it has `glob` / `exclude` and nothing matches. The list is never chunked. Functions go in named tasks only, not in the string or array forms.
- Placeholder expansion with chunking to stay under OS limits: 8000 characters on Windows (`cmd.exe` takes 8191), 100 000 bytes elsewhere (Linux caps one argument, the `sh -c` command, at 128 KiB). A longer command runs several times in a row, each with the next files of its longest list, and stops at the first failure.
- File paths are passed relative to the working directory, properly quoted.
- With `parallel: true` (object form of a hook), tasks run concurrently, respecting `dependsOn`. Every task is prepared first (file lists read, `stageFixed` snapshot taken), so no task sees another's changes in its list. All tasks run to the end; each failure is reported, and the exit code is the first failed task's in config order. The hook's stdin is read up front and every task gets a copy. Fixed files are staged as each task passes (`git add` is synchronous, so two never overlap); tasks that run at the same time should not change the same files.
- Output is streamed. In parallel mode Ward pipes it and writes whole lines only, each prefixed with the task name padded to the longest one (`lint      | …`), so lines of different tasks never mix; stdout stays stdout and stderr stays stderr. Names are colored when Ward's stream shows colors (terminal, no `NO_COLOR`), and commands get `FORCE_COLOR=1` then, since tools turn colors off for a pipe; a `FORCE_COLOR` or `NO_COLOR` set by the user wins. What a function task prints is not prefixed (it shares Ward's process); the error it throws is.
- Tasks can be skipped by tag: `WARD_SKIP_TAGS=slow` or `--skip-tag slow`.

### Monorepo and task graph

- `root` sets the task's working directory. When `root` is a glob (`packages/*`), the task runs once per matching package that has changed files - the "affected packages".
- `dependsOn` orders tasks; a task is skipped when one of its dependencies fails.
- A task with no matching files is skipped, so e.g. `tsc` only runs when `.ts` files changed.

### Cache

With `cache: true`, Ward stores content hashes of files that passed a task in `.git/ward/cache.json`, keyed by task name and command. On the next run, files with an unchanged hash are dropped from the task's file list; if none are left, the task is skipped. Changing the task invalidates its entries.

### CI mode

`ward run <hook> --ci` uses the same config:

- Files come from `--from-ref <ref>` (diff against the base branch) or `--all-files`.
- No autofix: tasks run, Ward prints `git diff` of what they changed, restores the tree and fails if anything changed.
- When `GITHUB_ACTIONS=true`, failures are also printed as `::error file=…,line=…::` annotations.

`ward` (install) stays a no-op when `CI` is set (not `0` / `false`), outside a git working tree, or when git is not installed, so `npm install` in Docker/CI doesn't fail.

### Report

After each run Ward prints: status and duration per task, the reason a task failed (exit code, first error lines), and a hint on how to fix it (e.g. the command to run locally, or `--no-verify` for an emergency).

### Skip

- `WARD=0` → the stub skips Ward without starting it; `ward run` called directly exits 0 too. A chained `<hook>.pre-ward` still runs: it is not Ward's (`--no-verify` skips everything).
- Merge / rebase in progress → `run` exits 0.
- `WARD_SKIP_TAGS` / `--skip-tag` → skip tagged tasks.

## Dependencies (target: small)

- `yaml` - YAML parsing
- `picomatch` - globbing
- Everything else: Node built-ins (`child_process`, `fs`, `crypto`, `util.parseArgs`) - also available in Bun and Deno

## Platform support

- Node ≥ 24, Bun ≥ 1.1, Deno ≥ 2
- macOS, Linux, Windows (Git Bash runs `#!/bin/sh` stubs); all three in the CI matrix
- Git ≥ 2.20

## Not planned

- A scripts folder with a per-language runner (as in lefthook). Plain commands already cover it: `run: python scripts/check.py`.
- A Go binary. Maybe later; for now Ward is a JS package for Node, Bun and Deno.
