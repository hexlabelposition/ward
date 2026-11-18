# Changelog

All notable changes to this project. `0.x` versions may break config and behavior (see [BACKLOG.md](./BACKLOG.md)).

## 0.2.0 - 2026-11-18

Tasks on staged files: Ward replaces lint-staged.

### Added

- Named tasks: `{ tasks: { name: { run } } }`, run in the order they are listed.
- `glob` and `exclude` per task pick the files a task runs on. A task with no matching files is skipped.
- `{staged_files}`, `{push_files}` and `{all_files}` placeholders. Long file lists are split into several runs, so they fit the command line limit on Windows.
- Symlinks are left out of file lists; `symlinks: true` passes them to the task.
- Files fixed by a task are staged again; `stageFixed: false` leaves them unstaged.
- Function tasks in `ward.config.ts`: a function that gets the file list.
- `parallel: true` runs the tasks of a hook at the same time, with each line of output prefixed by the task name.
- A backup with `git stash create` before every run; `backup: false` or `--no-backup` skips it.
- Partial staging: unstaged changes of partially staged files are hidden while tasks run and put back afterwards.
- When a task fails, the index and working tree are reverted to the backup; `revert: false` or `--no-revert` keeps the changes of the tasks.
- Deletions, binary files, renames, symlinks and merge conflicts are handled in the backup and partial staging.
- A `pre-commit` whose tasks undid every staged change fails instead of making an empty commit.
- `ward --bin <path>` sets the binary the hooks call instead of `node_modules/.bin/ward`.

## 0.1.0 - 2026-11-11

First release: Ward replaces husky.

### Added

- `ward` (run from `"prepare"`) writes a stub for every git hook into `.git/hooks`; `ward uninstall` removes them.
- Config in `ward.config.ts`, `ward.yml` / `ward.yaml` or the `"ward"` section of `package.json`, with `defineConfig()` for types.
- Hook values: a command, a list of commands or named tasks. Commands run in order and the first failure stops the hook.
- `{1}`, `{2}` … placeholders for the arguments git passes to the hook.
- Existing hooks are never overwritten silently: `--chain` keeps them and runs them before Ward, `--force` replaces them.
- `core.hooksPath` is detected and explained; `--respect-hooks-path` installs into that directory.
- Config validation that reports every problem at once, with suggestions for typos.
- `WARD=0` skips Ward. Hooks are skipped during a merge or rebase, and install is a no-op in CI and outside a git repository.
