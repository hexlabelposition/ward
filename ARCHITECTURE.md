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
- **Install on Bun:** `bun install` runs the root `prepare` script, same as npm. `init` detects `bun.lock` / `bun.lockb`.
- **Install on Deno:** there is no `prepare` lifecycle and no `node_modules/.bin` by default, so the stub calls `deno run -A npm:@hexlabelposition/ward` and `init` adds a `deno.json` task (`deno task prepare`). `init` detects `deno.json` / `deno.lock`.

### No `.ward/` folder - stubs in `.git/hooks`

`.git/hooks` is not committed, so each clone generates its own stubs via `prepare`. Repo stays clean: only the config is versioned.

The hooks directory is resolved with `git rev-parse --git-path hooks` - never hardcoded - so worktrees and submodules work.

### Stubs for all hooks → dynamic config

`ward` (no arguments, run from `prepare`) writes a stub for **every** supported git hook, not just the ones in the config. The stub has no logic:

```sh
#!/bin/sh
# ward:managed v1
[ "$WARD" = "0" ] && exit 0
bin="$(git rev-parse --show-toplevel)/node_modules/.bin/ward"
case "${WARD_RUNTIME:-node}" in   # default = runtime that ran install
  bun)  exec bun "$bin" run pre-commit "$@" ;;
  deno) exec deno run -A npm:@hexlabelposition/ward run pre-commit "$@" ;;
  *)    exec "$bin" run pre-commit "$@" ;;
esac
```

Because the config is read on every run, adding/removing hooks in the config needs no reinstall. When the stub format or the active-hooks cache gets out of date (new Ward version, config changed), `ward run` rewrites the stubs itself, so users never have to reinstall by hand.

- `# ward:managed v1` - marker used by `uninstall` and for upgrade detection.
- Calls the local binary directly, not `npx` / `bunx` (much faster startup).
- Each clone writes its own stubs, so team members on different runtimes don't conflict.

### Fast no-op path

Most hooks (e.g. `post-checkout`) will usually be empty. `run` must:

1. Find config file (no heavy imports yet).
2. Load config.
3. If the hook is absent → `exit 0` before loading runner, git, glob modules.

Lazy `import()` keeps cold start minimal.

**Later optimization:** `.git/ward-hooks.json` holds the list of active hooks; the stub checks it in shell and exits without starting Node. Invalidated by config mtime.

### Merge and rebase

If `MERGE_HEAD`, `rebase-merge/` or `rebase-apply/` exists in the git dir, `ward run` exits 0 without running tasks. Commits created by git during a merge or rebase are not the user's working changes.

### Config loading

| File               | Loader                                         |
| ------------------ | ---------------------------------------------- |
| `ward.config.ts`   | native `import()` (Node / Bun / Deno)          |
| `ward.yml`, `.yaml`| `yaml`                                         |
| `package.json`     | `JSON.parse`, `"ward"` key                     |

Discovery order: `ward.config.ts` → `ward.yml` / `ward.yaml` → `package.json`. If several sources exist → error, not a silent pick.

Merge order: `extends` packages (in listed order) → repo config → `ward.local.*`.

Function tasks and the task graph (`dependsOn`, `root`) are only available in the TS config; YAML and `package.json` hold plain data. The docs must say this explicitly.

`defineConfig` gives types and autocomplete; `schema.ts` validates every source at load time with clear errors (unknown hook, unknown option, bad glob). A JSON Schema covers YAML and `package.json`.

All forms are normalized to one internal model:

```ts
type HookConfig = {
  tasks: Task[]; // from string | string[] | { tasks: { name: task } }
  parallel: boolean;
  backup: boolean;
  revert: boolean;
};

type Task = {
  name: string;
  run: string | ((ctx: { files: string[] }) => unknown);
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

| Entry             | Resolved as                                                        |
| ----------------- | ------------------------------------------------------------------ |
| `ward:<name>`     | Built-in preset from `src/presets/`                                |
| Config object     | Used as is (TS config: `import { ts } from "@hexlabelposition/ward/presets"`) |
| `./…`, `../…`     | Local config file, relative to the config that lists it            |
| Package name      | npm package resolved from the repo root via `import.meta.resolve`; default export (config object) or `ward.yml` in the package root |

**Presets live in the main package**, not in separate `ward-preset-*` packages: a preset is a few lines of config, so it adds almost nothing to package size, needs no extra install, and its version always matches Ward's. The trade-off - a preset change needs a Ward release - is fine for presets.

**Shared company configs** can't ship with Ward, so they come from a local path or an npm package. npm is preferred over a git URL: the version is pinned by the lockfile, runs are offline, private configs use the usual registry auth, the same resolution works on Node, Bun and Deno (`npm:` specifiers), and nothing is downloaded and executed behind the lockfile's back. Git-hosted configs may come later, YAML only.

### File sources

| Source           | How                                                  |
| ---------------- | ---------------------------------------------------- |
| `{staged_files}` | `git diff --cached --name-only -z --diff-filter=ACMR` |
| `{push_files}`   | diff between the remote ref and the local ref from the `pre-push` stdin |
| `{all_files}`    | `git ls-files -z`                                    |
| `--from-ref`     | `git diff --name-only -z <ref>...HEAD`               |

Symlinks are dropped unless the task sets `symlinks: true`.

### Partial staging and backup (the hard part)

Problem: a file is partially staged; a formatter rewrites the whole file and you'd commit unstaged work or lose it.

Approach (same idea as lint-staged):

1. Save a backup: `git stash create` → keep the hash (does not touch the working tree). Always on; `--no-backup` / `backup: false` skips it for large repos.
2. Write a patch of unstaged changes for partially staged files: `git diff --binary`.
3. Check out the index version of those files: `git checkout-index` / `git restore --worktree`.
4. Run tasks.
5. `git add` files the tasks modified, except for tasks with `stageFixed: false`.
6. Re-apply the unstaged patch (`git apply --3way`).
7. On task failure → restore from backup hash and report. `--no-revert` / `revert: false` keeps task changes for inspection. Without a backup a full revert is not possible; only the unstaged patch is restored.

Edge cases to cover with tests: binary files, renames, deleted files, merge in progress, empty commit after formatting, non-ASCII paths, symlinks.

### Existing hooks

On install, if a hook file exists **without** the marker:

- Default: rename to `<hook>.pre-ward` and chain it from the stub.
- `--force`: overwrite.

If `core.hooksPath` is set, git ignores `.git/hooks` → print a clear warning and exit non-zero (unless `--respect-hooks-path`, which installs there instead). `ward doctor` reports the same, plus leftovers from husky, lefthook and simple-git-hooks.

### Task execution

- Commands run through the system shell, cwd = repo root or the task's `root`.
- Function tasks are called in-process with the matched file list.
- Placeholder expansion with chunking to stay under OS argument limits (Windows ~8k chars).
- File paths are passed relative to the working directory, properly quoted.
- With `parallel: true`, tasks run concurrently, respecting `dependsOn`.
- Output is streamed; in parallel mode, prefixed with task name.
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

`ward` (install) stays a no-op when `CI=true` or outside a git repo, so `npm install` in Docker/CI doesn't fail.

### Report

After each run Ward prints: status and duration per task, the reason a task failed (exit code, first error lines), and a hint on how to fix it (e.g. the command to run locally, or `--no-verify` for an emergency).

### Skip

- `WARD=0` → stub exits immediately.
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
