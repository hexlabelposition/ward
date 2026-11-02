# Backlog

Versions in the order they are planned. Not tied to dates. Each version has one goal and a "done when" line; anything that doesn't serve the goal goes to a later version. Sections refer to [ARCHITECTURE.md](./ARCHITECTURE.md).

`0.x` versions may break config and behavior. `1.0` freezes the config format and stub behavior: after it, breaking changes need a major version.

Items are numbered so early commits can point to them, for example `feat(hooks): write stubs on install (W9)`. Numbers are not reused: dropped items keep their numbers retired, new items get the next free number, so numbers inside a version are not always in order. Moving an item to another version keeps its number.

## Project setup

An empty project that builds, lints and tests.

- [x] **W1** Check that the `ward` name is available on npm and GitHub, reserve `@hexlabelposition/ward`
- [x] **W2** Set up tooling: TypeScript, tsdown build, ESM output, `bin` entry, `engines.node: ">=24"`
- [x] **W3** Test setup: vitest + helper that creates temp git repos
- [x] **W4** Lint/format for the project itself (dogfooding moved to W84)
- [x] **W5** CI: GitHub Actions matrix - Ubuntu, macOS, Windows × Node 24 + current, Bun latest, Deno 2

## 0.1 - Replace husky

Hooks from the config, on Node.

Done when: `npm i -D @hexlabelposition/ward` + `"prepare": "ward"` + a config fully replace husky, without breaking existing hooks.

### Install

- [x] **W6** `git/paths`: resolve repo root and hooks dir via `git rev-parse`
- [x] **W7** `hooks/list`: list of all supported git hook names
- [x] **W8** `hooks/stub`: stub template with `ward:managed` marker
- [x] **W9** `ward` (no args, used as `"prepare": "ward"`): write stubs for all hooks, chmod +x
- [x] **W10** Install is a no-op outside a git repo and in CI
- [x] **W40** Existing foreign hooks: ask (TTY) or `--chain`, then back up to `<hook>.pre-ward` and chain (ARCHITECTURE "Existing hooks")
- [ ] **W41** `core.hooksPath` set → clear warning / `--respect-hooks-path`
- [ ] **W42** Install `--force`
- [ ] **W19** `ward uninstall`: remove only stubs with marker

### Config

- [ ] **W11** Config discovery: `ward.config.ts` → `ward.{yml,yaml}` → `package.json`; error when several exist
- [ ] **W12** Load TS config with native Node type stripping, YAML via `yaml`, `"ward"` section of `package.json`
- [ ] **W13** `defineConfig()` + exported types
- [ ] **W14** Normalize config: string / array / `{ tasks }`
- [ ] **W45** Config validation with helpful errors (unknown hook name, unknown option, bad glob)

### Run

- [ ] **W15** `ward run <hook>`: fast exit when hook not configured
- [ ] **W16** Run commands sequentially, stop on first failure, propagate exit code
- [ ] **W17** `{1}`, `{2}` placeholders for git hook args
- [ ] **W18** `WARD=0` skip
- [ ] **W60** Skip hooks automatically during merge / rebase

### Release

- [ ] **W50** README with examples
- [ ] **W51** Changesets for versioning and changelog
- [ ] **W52** Publish to npm with provenance

## 0.2 - Replace lint-staged

Tasks on staged files, without losing user changes. Files and safety ship together: running formatters on partially staged files without a backup can lose work.

Done when: this repo runs its own Prettier and ESLint through Ward on staged files (W84), and partial staging survives a formatter run.

### Files and tasks

- [ ] **W26** List staged files (`--diff-filter=ACMR`, null-separated)
- [ ] **W65** List push files (`pre-push` stdin refs) and all tracked files
- [ ] **W28** Named tasks: `{ tasks: { name: { run, ... } } }`
- [ ] **W27** `glob` / `exclude` per task (picomatch)
- [ ] **W29** `{staged_files}`, `{push_files}`, `{all_files}` placeholders
- [ ] **W32** Skip task when no files match
- [ ] **W66** Ignore symlinks by default, `symlinks: true` to include
- [ ] **W31** Argument chunking for long file lists (Windows limit)
- [ ] **W30** `git add` files fixed by tasks; `stageFixed: false` opts out per task
- [ ] **W67** Function tasks: JS/TS function gets the file list (TS config only)
- [ ] **W33** `parallel: true` for tasks
- [ ] **W34** Prefixed, readable output in parallel mode

### Safety

ARCHITECTURE "Partial staging and backup".

- [ ] **W35** Backup via `git stash create` before every run; `--no-backup` / `backup: false` for large repos
- [ ] **W36** Partial staging: hide unstaged hunks, run, restore with `git apply --3way`
- [ ] **W37** Revert from backup when a task fails; `--no-revert` / `revert: false`
- [ ] **W38** Handle: binary files, renames, deletions, merge in progress, symlinks
- [ ] **W39** Detect "empty commit after formatting" and fail with clear message

### Dogfooding

- [ ] **W84** Dogfood: run this repo's Prettier and ESLint through Ward hooks

## 0.3 - Bun and Deno

Run on Bun and Deno, with or without Node installed (ARCHITECTURE "Runtimes").

Done when: the full test suite passes under Bun and Deno in CI, and install works with `bun install` and a `deno.json` task.

### Bun

- [ ] **W20** `runtime/detect`: detect Bun via `process.versions.bun`
- [ ] **W21** Verify TS config loads with native `import()` on Bun (full TS syntax)
- [ ] **W22** Stub for Bun; `WARD_RUNTIME=bun` override
- [ ] **W23** Run the test suite under Bun in CI
- [ ] **W24** Verify `bun install` runs `prepare` and installs stubs (incl. workspaces)

### Deno

- [ ] **W79** `runtime/detect`: detect Deno via `process.versions.deno`
- [ ] **W64** Stub for Deno: `deno run -A npm:@hexlabelposition/ward`; `WARD_RUNTIME=deno` override
- [ ] **W80** Install via a `deno.json` task (no `prepare` lifecycle, no `node_modules/.bin`)
- [ ] **W81** Run the test suite under Deno in CI

## 0.4 - CI and shared configs

The same config locally and in CI, shared across repos (ARCHITECTURE "CI mode", "Presets and shared configs").

Done when: a PR pipeline runs `ward run pre-commit --ci --from-ref origin/main` with the repo config, and a config can extend an npm package.

### CI mode

- [ ] **W68** `--from-ref <ref>`: files from the diff against the base branch
- [ ] **W48** `--all-files`: run tasks on the whole repo
- [ ] **W69** `--ci`: no autofix - run, show the diff of what would be fixed, restore, fail on changes
- [ ] **W70** GitHub Actions annotations output

### Config

- [ ] **W46** JSON Schema for `ward.yml` and the `package.json` section (editor autocomplete)
- [ ] **W71** `ward.local.*` override merged on top of the main config
- [ ] **W73** Rewrite stale stubs automatically when the config or stub version changes
- [ ] **W72** `extends`: built-in presets (`ward:<name>` / config object), local paths, npm packages
- [ ] **W78** Docs: function tasks and task graph are TS config only

## 0.5 - DX and speed

Easy to set up, clear when something goes wrong, fast when there is nothing to do (ARCHITECTURE "Fast no-op path").

Done when: `ward init` sets up a repo in one command, and a hook without tasks exits without starting Node.

### DX

- [ ] **W43** `ward init`: create starter config, add `"prepare": "ward"`, add `ward.local.*` to `.gitignore`
- [ ] **W44** `init` asks TS, YAML or `package.json` (or detects a TS project)
- [ ] **W25** `init`: detect `bun.lock` / `bun.lockb` and show Bun commands
- [ ] **W82** `init`: detect `deno.json` / `deno.lock` and show Deno commands
- [ ] **W47** Report after a run: timings per task, clear failure reason, fix hint
- [ ] **W54** `ward doctor`: `core.hooksPath` conflicts, leftover hooks from other managers, stub version

### Performance

- [ ] **W49** Lazy imports: config-only path for no-op hooks
- [ ] **W56** Cache active hooks in `.git/ward-hooks.json`; stub exits in shell without Node

## 0.6 - Monorepo

Tasks per package, ordered and cached.

Done when: in a workspace monorepo, a task with `root: "packages/*"` runs only in packages with changed files, in `dependsOn` order.

- [ ] **W59** `root` per task: working directory for a package
- [ ] **W74** Task tags; skip by tag via `WARD_SKIP_TAGS` / `--skip-tag`
- [ ] **W76** Task graph: `dependsOn`, skip dependents on failure
- [ ] **W77** Affected packages: `root` glob runs the task once per package with changed files
- [ ] **W75** Cache: skip files whose hash hasn't changed since the last green run

## 1.0 - Stable

Config format and stub behavior frozen; easy to switch from other tools.

Done when: a husky + lint-staged or lefthook repo migrates with one command, and the README shows how Ward compares.

- [ ] **W55** `ward migrate` from husky + lint-staged, lefthook, simple-git-hooks
- [ ] **W85** README comparison table vs husky + lint-staged, lefthook, simple-git-hooks
- [ ] **W57** Benchmark vs husky+lint-staged and lefthook
- [ ] **W53** Example repos: TS monorepo, plain JS, Next.js

## Later

- [ ] **W58** Docs site
- [ ] **W61** Built-in commit-msg check (conventional commits) without commitlint
- [ ] **W63** Built-in presets in the main package: `@hexlabelposition/ward/presets`, `extends: ['ward:ts']`
- [ ] **W83** Git-hosted shared configs (YAML only, pinned to a ref)

## Not planned

- Scripts folder with a per-language runner (as in lefthook) - plain commands cover it (`python scripts/check.py`)
- Go binary - maybe in the future, JS package for Node / Bun / Deno for now

Retired: W62 (task `env` / `cwd` - `cwd` became `root` in W59).

## Open questions

None right now.

Decided: foreign hooks are never chained silently - Ward asks in a terminal, otherwise leaves them and suggests `--chain` (W40).
