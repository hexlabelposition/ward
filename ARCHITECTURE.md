# Architecture

## Goals

1. One package replaces husky + lint-staged.
2. The only file in the repo is the config (`ward.config.ts` / `ward.yml`).
3. Config changes apply without reinstalling.
4. Fast no-op when a hook has nothing to do.
5. Never lose user changes (partial staging, existing hooks).

## High-level flow

```bash
npm install
   └─ "prepare": ward install
         └─ writes stubs → .git/hooks/<every-hook>

git commit
   └─ .git/hooks/pre-commit (stub)
         └─ ward run pre-commit "$@"
               ├─ load config (fresh, every time)
               ├─ no tasks for hook? → exit 0
               ├─ collect staged files
               ├─ stash unstaged changes
               ├─ run tasks (sequential / parallel)
               ├─ re-stage modified files
               ├─ restore stash
               └─ exit with task status
```

## Modules

```text
src/
├─ cli/            # argument parsing, commands: init, install, run, uninstall
├─ config/
│  ├─ discover.ts  # find ward.config.{ts,mts,js,mjs} / ward.{yml,yaml}
│  ├─ load-ts.ts   # load TS config (jiti)
│  ├─ load-yml.ts  # load YAML (yaml package)
│  ├─ schema.ts    # validation + normalization to internal model
│  └─ define.ts    # defineConfig() + public types
├─ git/
│  ├─ exec.ts      # thin wrapper around `git` child process
│  ├─ paths.ts     # git rev-parse --git-path hooks, repo root
│  ├─ staged.ts    # list staged files
│  └─ stash.ts     # partial-staging backup/restore
├─ hooks/
│  ├─ list.ts      # all supported git hook names
│  ├─ stub.ts      # stub template + marker
│  └─ install.ts   # write/remove stubs, detect foreign hooks
├─ runner/
│  ├─ match.ts     # glob → files (picomatch)
│  ├─ command.ts   # placeholder expansion, chunking long arg lists
│  ├─ exec.ts      # spawn commands, stream output
│  └─ run-hook.ts  # orchestrates one hook run
├─ runtime/
│  └─ detect.ts    # Node vs Bun detection, runtime-specific loaders
└─ index.ts        # public API: defineConfig, types
```

## Key decisions

### No `.ward/` folder - stubs in `.git/hooks`

`.git/hooks` is not committed, so each clone generates its own stubs via `prepare`. Repo stays clean: only the config is versioned.

The hooks directory is resolved with `git rev-parse --git-path hooks` - never hardcoded - so worktrees and submodules work.

### Stubs for all hooks → dynamic config

`install` writes a stub for **every** supported git hook, not just the ones in the config. The stub has no logic:

```sh
#!/bin/sh
# ward:managed v1
[ "$WARD" = "0" ] && exit 0
bin="$(git rev-parse --show-toplevel)/node_modules/.bin/ward"
if [ "$WARD_RUNTIME" != "bun" ] && command -v node >/dev/null 2>&1; then
  exec "$bin" run pre-commit "$@"
fi
exec bun "$bin" run pre-commit "$@"
```

Because the config is read on every run, adding/removing hooks in the config needs no reinstall. Reinstall is only needed when the stub format changes (handled by `prepare` on package update).

- `# ward:managed v1` - marker used by `uninstall` and for upgrade detection.
- Calls the local binary directly, not `npx` / `bunx` (much faster startup).
- Uses Node when available, otherwise Bun; `WARD_RUNTIME=bun` forces Bun (see [Runtimes](#runtimes)).

### Fast no-op path

Most hooks (e.g. `post-checkout`) will usually be empty. `run` must:

1. Find config file (no heavy imports yet).
2. Load config.
3. If the hook is absent → `exit 0` before loading runner, git, glob modules.

Lazy `import()` keeps cold start minimal.

**Later optimization:** `install` writes `.git/ward-hooks.json` with the list of active hooks; the stub checks it in shell and exits without starting Node. Invalidated by config mtime.

### Config loading

| File            | Loader                                                             |
| --------------- | ------------------------------------------------------------------ |
| `.ts`, `.mts`   | `jiti` on Node (no build step for users), native `import()` on Bun |
| `.js`, `.mjs`   | native `import()`                                                  |
| `.yml`, `.yaml` | `yaml`                                                             |

All forms are normalized to one internal model:

```ts
type HookConfig = {
  tasks: Task[]; // from string | string[] | { run }
  staged?: StagedGroup[]; // from { staged: { glob: cmds } }
  parallel: boolean;
  stash: boolean;
};
```

Discovery order is fixed; if several config files exist → error, not a silent pick.

### Partial staging (the hard part)

Problem: a file is partially staged; a formatter rewrites the whole file and you'd commit unstaged work or lose it.

Approach (same idea as lint-staged):

1. Save a backup: `git stash create` → keep the hash (does not touch the working tree).
2. Write a patch of unstaged changes for partially staged files: `git diff --binary`.
3. Check out the index version of those files: `git checkout-index` / `git restore --worktree`.
4. Run tasks.
5. `git add` files the tasks modified.
6. Re-apply the unstaged patch (`git apply --3way`).
7. On any failure → restore from backup hash and report.

Edge cases to cover with tests: binary files, renames, deleted files, merge in progress, empty commit after formatting, non-ASCII paths.

### Existing hooks

On `install`, if a hook file exists **without** the marker:

- Default: rename to `<hook>.pre-ward` and chain it from the stub.
- `--force`: overwrite.

If `core.hooksPath` is set, git ignores `.git/hooks` → print a clear warning and exit non-zero (unless `--respect-hooks-path`, which installs there instead).

### Command execution

- Commands run through the system shell, cwd = repo root.
- `{files}` expansion with chunking to stay under OS argument limits (Windows ~8k chars).
- File paths are passed relative to repo root, properly quoted.
- Output is streamed; in parallel mode, prefixed with group name.

### CI and skip

- `WARD=0` → stub exits immediately.
- `install` is a no-op when `CI=true` or when not inside a git repo (so `npm install` in Docker/CI doesn't fail).

## Dependencies (target: small)

- `jiti` - TS config loading (Node only; loaded lazily, never imported on Bun)
- `yaml` - YAML parsing
- `picomatch` - globbing
- Everything else: Node built-ins (`child_process`, `fs`, `util.parseArgs`) - also available in Bun

### Runtimes

The code targets the Node API surface that Bun implements, so one build runs on both. Runtime-specific behavior is isolated in a small `runtime/` module (detect via `process.versions.bun`):

- **TS config:** Bun imports `.ts` natively → skip `jiti`.
- **Stub:** prefers `node`, falls back to `bun`, so Bun-only machines and containers work. `WARD_RUNTIME=bun` forces Bun even when Node is installed.
- **Install:** `bun install` runs the root `prepare` script, so setup is the same as with npm. `init` detects `bun.lock` / `bun.lockb` and prints Bun-flavored instructions.

**Deno (planned):** Deno can run npm packages via `npm:` specifiers and supports Node built-ins, but it has no `node_modules/.bin` by default and no `prepare` lifecycle. It will need a different stub target (e.g. `deno run -A npm:@hexlabelposition/ward`) and an install step via a `deno.json` task. Not part of the first release.

## Platform support

- Node ≥ 18 or Bun ≥ 1.1 (Deno planned)
- macOS, Linux, Windows (Git Bash runs `#!/bin/sh` stubs)
- Git ≥ 2.20
