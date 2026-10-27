# Backlog

Milestones in the order they are planned. Not tied to dates. Sections refer to [ARCHITECTURE.md](./ARCHITECTURE.md).

Items are numbered so early commits can point to them, for example `feat(hooks): write stubs on install (W9)`. Numbers are not reused.

## Project setup

An empty project that builds, lints and tests.

- [ ] **W1** Check that the `ward` name is available on npm and GitHub, reserve `@hexlabelposition/ward`
- [ ] **W2** Set up tooling: TypeScript, tsup build, ESM + CJS output, `bin` entry
- [ ] **W3** Test setup: vitest + helper that creates temp git repos
- [ ] **W4** Lint/format for the project itself (dogfood Ward once it works)
- [ ] **W5** CI: GitHub Actions matrix - Ubuntu, macOS, Windows × Node 18/20/22 + Bun latest

## MVP - hooks without staged files

Replace husky.

- [ ] **W6** `git/paths`: resolve repo root and hooks dir via `git rev-parse`
- [ ] **W7** `hooks/list`: list of supported git hook names
- [ ] **W8** `hooks/stub`: stub template with `ward:managed` marker
- [ ] **W9** `ward install`: write stubs for all hooks, chmod +x
- [ ] **W10** `ward install`: no-op outside git repo and in CI
- [ ] **W11** Config discovery: `ward.config.{ts,mts,js,mjs}`, `ward.{yml,yaml}`
- [ ] **W12** Load TS config via jiti, YAML via `yaml`
- [ ] **W13** `defineConfig()` + exported types
- [ ] **W14** Normalize config: string / array / `{ run }`
- [ ] **W15** `ward run <hook>`: fast exit when hook not configured
- [ ] **W16** Run commands sequentially, stop on first failure, propagate exit code
- [ ] **W17** `{1}`, `{2}` placeholders for git hook args
- [ ] **W18** `WARD=0` skip
- [ ] **W19** `ward uninstall`: remove only stubs with marker

## Bun support

Run on Bun, with or without Node installed (ARCHITECTURE "Runtimes").

- [ ] **W20** `runtime/detect`: detect Bun via `process.versions.bun`
- [ ] **W21** Load TS config with native `import()` on Bun (skip jiti)
- [ ] **W22** Stub: fall back to `bun` when `node` is missing; `WARD_RUNTIME=bun` override
- [ ] **W23** Run the test suite under Bun in CI
- [ ] **W24** Verify `bun install` runs `prepare` and installs stubs (incl. workspaces)
- [ ] **W25** `init`: detect `bun.lock` / `bun.lockb` and show Bun commands

## Staged files

Replace lint-staged.

- [ ] **W26** List staged files (`--diff-filter=ACMR`, null-separated)
- [ ] **W27** Glob matching with picomatch
- [ ] **W28** `staged` config: glob → command(s)
- [ ] **W29** `{files}` placeholder; append files automatically when omitted
- [ ] **W30** Re-stage files modified by tasks
- [ ] **W31** Argument chunking for long file lists (Windows limit)
- [ ] **W32** Skip group when no files match
- [ ] **W33** `parallel: true` for glob groups
- [ ] **W34** Prefixed, readable output in parallel mode

## Safety

Never lose user changes (ARCHITECTURE "Partial staging", "Existing hooks").

- [ ] **W35** Backup via `git stash create` before running staged tasks
- [ ] **W36** Partial staging: hide unstaged hunks, run, restore with `git apply --3way`
- [ ] **W37** Restore from backup on any failure
- [ ] **W38** Handle: binary files, renames, deletions, merge in progress
- [ ] **W39** Detect "empty commit after formatting" and fail with clear message
- [ ] **W40** Existing foreign hooks: back up to `<hook>.pre-ward` and chain
- [ ] **W41** `core.hooksPath` set → clear warning / `--respect-hooks-path`
- [ ] **W42** `install --force`

## DX

Easy to set up, clear when something goes wrong.

- [ ] **W43** `ward init`: create starter config, add `prepare` script
- [ ] **W44** `init` asks TS or YAML (or detect TS project)
- [ ] **W45** Config validation with helpful errors (unknown hook name, bad glob)
- [ ] **W46** JSON Schema for `ward.yml` (editor autocomplete)
- [ ] **W47** Colored output, timings per task, summary at the end
- [ ] **W48** `ward run <hook> --all-files` (run staged tasks on whole repo)

## Performance

Fast no-op when a hook has nothing to do (ARCHITECTURE "Fast no-op path").

- [ ] **W49** Lazy imports: config-only path for no-op hooks

## Release

First public release.

- [ ] **W50** README with examples and comparison table
- [ ] **W51** Changesets for versioning and changelog
- [ ] **W52** Publish to npm with provenance
- [ ] **W53** Example repos: TS monorepo, plain JS, Next.js

## Later

- [ ] **W54** `ward doctor`: check install state, hooksPath, config, stub version
- [ ] **W55** Migration: `ward migrate` from husky + lint-staged config
- [ ] **W56** Cache active hooks in `.git/ward-hooks.json`; stub exits in shell without Node
- [ ] **W57** Benchmark vs husky+lint-staged and lefthook (Node and Bun)
- [ ] **W58** Docs site
- [ ] **W59** Monorepo support: per-package configs, run tasks in package cwd
- [ ] **W60** `skip` conditions: on merge, on rebase, by branch
- [ ] **W61** Built-in commit-msg check (conventional commits) without commitlint
- [ ] **W62** Task `env` and `cwd` options
- [ ] **W63** Plugin presets: `extends: '@hexlabelposition/ward-preset-ts'`
- [ ] **W64** Deno support: stub via `deno run -A npm:@hexlabelposition/ward`, install via `deno.json` task (no `node_modules/.bin`, no `prepare`)

## Open questions

- Support `.js` configs or TS + YAML only?
- Stub chaining for foreign hooks by default, or refuse and ask?
