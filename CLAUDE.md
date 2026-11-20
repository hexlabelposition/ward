# Ward

Git hooks manager for Node, Bun and Deno. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the design and [BACKLOG.md](./BACKLOG.md) for planned work before changing behavior.

## Commands

Bun is the package manager (`bun.lock`).

```bash
bun install
bun run typecheck && bun run lint && bun run format:check
bun run test        # Node
bun run test:bun    # Bun
bun run test:deno   # Deno
```

CI runs the suite on all three runtimes on Ubuntu, macOS and Windows. Run all three locally before calling a change done; add `CI=true` to match the runners.

## Rules

- Backlog items: implement one `Wn` at a time, tick it in BACKLOG.md in the same commit, and put the number in the subject: `feat(hooks): ... (W22)`. Numbers are never reused (see BACKLOG.md).
- Commits: Conventional Commits, scope = `src/` folder or area (`cli`, `hooks`, `config`, `runtime`, `github`), lowercase imperative subject.
- No history rewrites: fix a pushed commit with a new commit.
- When behavior changes, update README.md and ARCHITECTURE.md in the same change. There is no CHANGELOG.md: changes are described in GitHub Releases.
- Docs and code comments are in English; docs use a spaced hyphen, not em dashes.
- Runtime dependencies stay at `yaml` and `picomatch`; everything else is Node built-ins that Bun and Deno implement.
- Runtime-specific code lives in `src/runtime/`. CLI commands are imported lazily to keep the no-op hook path fast.

## Releases

`bun run release` (bumpp) bumps the version, commits `chore: release vX.Y.Z`, tags and pushes. The tag runs `.github/workflows/release.yml`: CI, build, `npm stage publish` (approve it on npmjs.com or with `npm stage approve`), then a **draft** GitHub release listing the commits.

Rewrite the draft in the style of v0.1.0 and v0.2.0, then publish it:

1. One sentence: the goal of the version, then the 0.x warning (`> [!WARNING]`).
2. `## Install`: the commands, provenance, Node / runtime requirements, runtime dependencies.
3. `## What's in vX.Y`: user-facing changes grouped under bold headings, one line each.
4. `## Moving from <tool>` when the version replaces one, with a link to the README section.
5. `## Tested on`: the CI matrix.
6. `## What's next`: the next one or two versions from BACKLOG.md.
7. `**Full Changelog**: https://github.com/hexlabelposition/ward/compare/vPREV...vX.Y.Z`

## Gotchas

- Stubs are POSIX `sh` and must work in Git Bash on Windows; they are always written with LF.
- Tests spawn the CLI with `process.execPath`, which is Bun or Deno under `test:bun` / `test:deno`. Use the helpers in `test/helpers/` (`writeWardBin`, `evalCommand`) instead of hardcoding `node`.
- Deno's `child_process` merges the parent's env into `env`: set a variable to `""` instead of deleting it.
- `bun --bun` puts a fake `node` (Bun) first in `PATH`; tests that need real Node find it with `findNode()` in `test/config/load-ts.test.ts`.
- Bun on Windows writes `.bin/ward.exe`, not `.bin/ward`.
- `test:deno` runs vitest through `test/run-deno.ts`, which drops Deno's "IPC channel is already disconnected" error from closing vitest's workers (seen on Windows). Remove the wrapper once Deno fixes it.
