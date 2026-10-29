# Backlog

Milestones in the order they are planned. Not tied to dates. Sections refer to [ARCHITECTURE.md](./ARCHITECTURE.md).

Items are numbered so early commits can point to them, for example `feat(hooks): write stubs on install (W9)`. Numbers are not reused: dropped items keep their numbers retired, new items get the next free number, so numbers inside a milestone are not always in order.

## Project setup

An empty project that builds, lints and tests.

- [ ] **W1** Check that the `ward` name is available on npm and GitHub, reserve `@hexlabelposition/ward`
- [ ] **W2** Set up tooling: TypeScript, tsup build, ESM output, `bin` entry, `engines.node: ">=24"`
- [ ] **W3** Test setup: vitest + helper that creates temp git repos
- [ ] **W4** Lint/format for the project itself (dogfood Ward once it works)
- [ ] **W5** CI: GitHub Actions matrix - Ubuntu, macOS, Windows × Node 24 + current, Bun latest, Deno 2

## MVP - hooks without staged files

Replace husky.

- [ ] **W6** `git/paths`: resolve repo root and hooks dir via `git rev-parse`
- [ ] **W7** `hooks/list`: list of all supported git hook names
- [ ] **W8** `hooks/stub`: stub template with `ward:managed` marker
- [ ] **W9** `ward` (no args, used as `"prepare": "ward"`): write stubs for all hooks, chmod +x
- [ ] **W10** Install is a no-op outside a git repo and in CI
- [ ] **W11** Config discovery: `ward.config.ts` → `ward.{yml,yaml}` → `package.json`; error when several exist
- [ ] **W12** Load TS config with native Node type stripping, YAML via `yaml`, `"ward"` section of `package.json`
- [ ] **W13** `defineConfig()` + exported types
- [ ] **W14** Normalize config: string / array / `{ tasks }`
- [ ] **W15** `ward run <hook>`: fast exit when hook not configured
- [ ] **W16** Run commands sequentially, stop on first failure, propagate exit code
- [ ] **W17** `{1}`, `{2}` placeholders for git hook args
- [ ] **W18** `WARD=0` skip
- [ ] **W60** Skip hooks automatically during merge / rebase
- [ ] **W19** `ward uninstall`: remove only stubs with marker

## Bun support

Run on Bun, with or without Node installed (ARCHITECTURE "Runtimes").

- [ ] **W20** `runtime/detect`: detect Bun via `process.versions.bun`
- [ ] **W21** Verify TS config loads with native `import()` on Bun (full TS syntax)
- [ ] **W22** Stub for Bun; `WARD_RUNTIME=bun` override
- [ ] **W23** Run the test suite under Bun in CI
- [ ] **W24** Verify `bun install` runs `prepare` and installs stubs (incl. workspaces)
- [ ] **W25** `init`: detect `bun.lock` / `bun.lockb` and show Bun commands

## Deno support

Run on Deno, with or without Node installed (ARCHITECTURE "Runtimes").

- [ ] **W79** `runtime/detect`: detect Deno via `process.versions.deno`
- [ ] **W64** Stub for Deno: `deno run -A npm:@hexlabelposition/ward`; `WARD_RUNTIME=deno` override
- [ ] **W80** Install via a `deno.json` task (no `prepare` lifecycle, no `node_modules/.bin`)
- [ ] **W81** Run the test suite under Deno in CI
- [ ] **W82** `init`: detect `deno.json` / `deno.lock` and show Deno commands

## Files and tasks

Replace lint-staged.

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

## Safety

Never lose user changes (ARCHITECTURE "Partial staging and backup", "Existing hooks").

- [ ] **W35** Backup via `git stash create` before every run; `--no-backup` / `backup: false` for large repos
- [ ] **W36** Partial staging: hide unstaged hunks, run, restore with `git apply --3way`
- [ ] **W37** Revert from backup when a task fails; `--no-revert` / `revert: false`
- [ ] **W38** Handle: binary files, renames, deletions, merge in progress, symlinks
- [ ] **W39** Detect "empty commit after formatting" and fail with clear message
- [ ] **W40** Existing foreign hooks: back up to `<hook>.pre-ward` and chain
- [ ] **W41** `core.hooksPath` set → clear warning / `--respect-hooks-path`
- [ ] **W42** Install `--force`

## CI mode

Same config locally and in CI (ARCHITECTURE "CI mode").

- [ ] **W68** `--from-ref <ref>`: files from the diff against the base branch
- [ ] **W48** `--all-files`: run tasks on the whole repo
- [ ] **W69** `--ci`: no autofix - run, show the diff of what would be fixed, restore, fail on changes
- [ ] **W70** GitHub Actions annotations output

## Config

Typed, validated, shareable.

- [ ] **W45** Config validation with helpful errors (unknown hook name, unknown option, bad glob)
- [ ] **W46** JSON Schema for `ward.yml` and the `package.json` section (editor autocomplete)
- [ ] **W71** `ward.local.*` override merged on top of the main config
- [ ] **W73** Rewrite stale stubs automatically when the config or stub version changes
- [ ] **W72** `extends`: built-in presets (`ward:<name>` / config object), local paths, npm packages
- [ ] **W78** Docs: function tasks and task graph are TS config only

## Monorepo, graph and cache

- [ ] **W59** `root` per task: working directory for a package
- [ ] **W74** Task tags; skip by tag via `WARD_SKIP_TAGS` / `--skip-tag`
- [ ] **W76** Task graph: `dependsOn`, skip dependents on failure
- [ ] **W77** Affected packages: `root` glob runs the task once per package with changed files
- [ ] **W75** Cache: skip files whose hash hasn't changed since the last green run

## DX

Easy to set up, clear when something goes wrong.

- [ ] **W43** `ward init`: create starter config, add `"prepare": "ward"`, add `ward.local.*` to `.gitignore`
- [ ] **W44** `init` asks TS, YAML or `package.json` (or detects a TS project)
- [ ] **W47** Report after a run: timings per task, clear failure reason, fix hint
- [ ] **W54** `ward doctor`: `core.hooksPath` conflicts, leftover hooks from other managers, stub version
- [ ] **W55** `ward migrate` from husky + lint-staged, lefthook, simple-git-hooks

## Performance

Fast no-op when a hook has nothing to do (ARCHITECTURE "Fast no-op path").

- [ ] **W49** Lazy imports: config-only path for no-op hooks
- [ ] **W56** Cache active hooks in `.git/ward-hooks.json`; stub exits in shell without Node

## Release

First public release.

- [ ] **W50** README with examples and comparison table
- [ ] **W51** Changesets for versioning and changelog
- [ ] **W52** Publish to npm with provenance
- [ ] **W53** Example repos: TS monorepo, plain JS, Next.js

## Later

- [ ] **W57** Benchmark vs husky+lint-staged and lefthook
- [ ] **W58** Docs site
- [ ] **W61** Built-in commit-msg check (conventional commits) without commitlint
- [ ] **W63** Built-in presets in the main package: `@hexlabelposition/ward/presets`, `extends: ['ward:ts']`
- [ ] **W83** Git-hosted shared configs (YAML only, pinned to a ref)

## Not planned

- Scripts folder with a per-language runner (as in lefthook) - plain commands cover it (`python scripts/check.py`)
- Go binary - maybe in the future, JS package for Node / Bun / Deno for now

Retired: W62 (task `env` / `cwd` - `cwd` became `root` in W59).

## Open questions

- Stub chaining for foreign hooks by default, or refuse and ask?
