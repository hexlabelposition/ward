# ward

> Git hooks and staged-file linting in one tool. One config, zero hook folders.

`@hexlabelposition/ward` replaces the **husky + lint-staged** combo with a single package:

- **One config for all hooks** - `ward.config.ts` (typed, with autocomplete and validation), `ward.yml`, or a `"ward"` section in `package.json`
- **No `.husky/`-style folder** in your repo - hooks are generated locally into `.git/hooks`
- **Dynamic** - edit the config and the change applies on the next commit, no manual reinstall
- **Staged-files aware** - run tasks only on the files you are committing or pushing
- **Parallel** - independent tasks run at the same time
- **Safe** - state is backed up before every run, unstaged changes are hidden and restored, failed runs are reverted
- **Same config in CI** - check the diff against `origin/main` without autofix, with GitHub Actions annotations

> ⚠️ Status: early design stage. APIs below are the planned shape.

## Install

```bash
npm install -D @hexlabelposition/ward
npx ward init
```

With [Bun](https://bun.sh):

```bash
bun add -d @hexlabelposition/ward
bunx ward init
```

With [Deno](https://deno.com):

```bash
deno add npm:@hexlabelposition/ward
deno run -A npm:@hexlabelposition/ward init
```

`init` creates a starter config and adds a `prepare` script to `package.json`:

```json
{
  "scripts": {
    "prepare": "ward"
  }
}
```

After that, every `npm install` (or `bun install`) sets up the hooks for everyone on the team automatically. Deno has no `prepare` lifecycle, so `init` adds a `deno.json` task instead (`deno task prepare`).

### Runtimes

| Runtime   | Status                                   |
| --------- | ---------------------------------------- |
| Node ≥ 24 | Supported                                |
| Bun ≥ 1.1 | Supported - works without Node installed |
| Deno ≥ 2  | Planned - works without Node installed   |

Hook stubs use the runtime that installed them; `WARD_RUNTIME=node|bun|deno` overrides it.

### Quick start without a config file

For small projects the config can live in `package.json`:

```json
{
  "scripts": {
    "prepare": "ward"
  },
  "ward": {
    "hooks": {
      "pre-commit": {
        "tasks": {
          "format": {
            "glob": "*.{js,ts,md,json}",
            "run": "prettier --write {staged_files}"
          }
        }
      }
    }
  }
}
```

## Configuration

Ward looks for the config in this order:

1. `ward.config.ts`
2. `ward.yml` / `ward.yaml`
3. `"ward"` section in `package.json`

If more than one is found, Ward stops with an error instead of silently picking one.

| Feature                          | `ward.config.ts` | `ward.yml` | `package.json` |
| -------------------------------- | ---------------- | ---------- | -------------- |
| Commands, globs, tags, options   | yes              | yes        | yes            |
| Types and autocomplete           | yes              | via schema | via schema     |
| Function tasks                   | **TS only**      | no         | no             |
| Task graph (`dependsOn`, `root`) | **TS only**      | no         | no             |

`ward.config.ts` is loaded by the runtime's built-in TypeScript support (Node, Bun and Deno all have it) - no extra loader dependency. Node only strips types, so keep the config to erasable syntax (no `enum`, `namespace` or constructor parameter properties) if anyone on the team uses Node.

### TypeScript

```ts
// ward.config.ts
import { defineConfig } from "@hexlabelposition/ward";

export default defineConfig({
  hooks: {
    "pre-commit": {
      parallel: true,
      tasks: {
        lint: {
          glob: "*.{ts,tsx}",
          exclude: "src/generated/**",
          run: "eslint --fix {staged_files}",
        },
        format: {
          glob: "*.{css,md,json}",
          run: "prettier --write {staged_files}",
        },
        typecheck: {
          glob: "*.{ts,tsx}",
          run: "tsc --noEmit",
          tags: ["slow"],
          stageFixed: false,
        },
        "no-todo": {
          glob: "*.ts",
          run: async ({ files }) => {
            // a JS/TS function gets the matched file list
          },
        },
      },
    },
    "commit-msg": "commitlint --edit {1}",
    "pre-push": {
      tasks: {
        build: { run: "npm run build" },
        test: { run: "npm test", dependsOn: ["build"] },
      },
    },
  },
});
```

### YAML

```yaml
# ward.yml
hooks:
  pre-commit:
    parallel: true
    tasks:
      lint:
        glob: "*.{ts,tsx}"
        exclude: "src/generated/**"
        run: eslint --fix {staged_files}
      format:
        glob: "*.{css,md,json}"
        run: prettier --write {staged_files}
  commit-msg: commitlint --edit {1}
  pre-push:
    - npm run typecheck
    - npm test
```

### Hook value forms

| Form                        | Meaning                                      |
| --------------------------- | -------------------------------------------- |
| `'cmd'`                     | Run one command                              |
| `['a', 'b']`                | Run commands in order, stop on first failure |
| `{ tasks: { name: task } }` | Named tasks with options (see below)         |

### Task options

| Option       | Meaning                                                               |
| ------------ | --------------------------------------------------------------------- |
| `run`        | Command string, or a function `({ files }) => …` (TS config only)     |
| `glob`       | Only run on matching files; the task is skipped when nothing matches  |
| `exclude`    | Glob(s) to drop from the matched files                                |
| `root`       | Working directory for the task (monorepo package); can be a glob      |
| `tags`       | Labels used to skip groups of tasks                                   |
| `stageFixed` | `git add` files the task changed (default: `true`)                    |
| `symlinks`   | Include symlinked files (default: `false`)                            |
| `cache`      | Skip files whose content hash hasn't changed since the last green run |
| `dependsOn`  | Run only after these tasks succeed (TS config only)                   |

### Hook options

| Option     | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `parallel` | Run independent tasks at the same time                            |
| `backup`   | Back up state before running (default: `true`, see `--no-backup`) |
| `revert`   | Revert changes when a task fails (default: `true`)                |

### Placeholders

| Placeholder      | Value                                                       |
| ---------------- | ----------------------------------------------------------- |
| `{staged_files}` | Staged files matching the task's `glob` / `exclude`         |
| `{push_files}`   | Files changed in the commits being pushed                   |
| `{all_files}`    | All tracked files matching the task's `glob` / `exclude`    |
| `{1}`, `{2}` …   | Arguments git passed to the hook (e.g. commit message file) |

Long file lists are split into chunks so commands stay under OS argument limits (Windows in particular).

### Local overrides

`ward.local.ts` / `ward.local.yml` is merged on top of the main config. It is meant for personal tweaks and should be in `.gitignore` (`ward init` adds it).

### Presets and shared configs

`extends` takes a list of configs to start from. The repo config and `ward.local.*` are merged on top.

| Entry           | Example                   | Use for                                       |
| --------------- | ------------------------- | --------------------------------------------- |
| Built-in preset | `"ward:ts"` / `ts` import | Ready-made setups shipped inside Ward         |
| Local path      | `"../shared/ward.yml"`    | Monorepos, configs next to the repo           |
| npm package     | `"@acme/ward-config"`     | One config for many repositories of a company |

```ts
// ward.config.ts
import { defineConfig } from "@hexlabelposition/ward";
import { ts } from "@hexlabelposition/ward/presets";

export default defineConfig({
  extends: [ts, "@acme/ward-config"],
  hooks: { ... },
});
```

```yaml
# ward.yml
extends: ["ward:ts", "../shared/ward.yml"]
```

Presets ship with Ward, so there is nothing extra to install and their version always matches Ward's. npm configs are pinned by your lockfile; runs need no network.

## CLI

| Command           | What it does                                                           |
| ----------------- | ---------------------------------------------------------------------- |
| `ward`            | Install hook stubs into `.git/hooks` (what `prepare` runs)             |
| `ward init`       | Create config, `prepare` script and `.gitignore` entry (run once)      |
| `ward run <hook>` | Run a hook manually - useful for testing without committing            |
| `ward doctor`     | Find `core.hooksPath` conflicts and leftovers from other hook managers |
| `ward migrate`    | Convert husky + lint-staged, lefthook or simple-git-hooks setups       |
| `ward uninstall`  | Remove Ward's hook stubs                                               |

`ward run` flags:

| Flag               | Meaning                                                    |
| ------------------ | ---------------------------------------------------------- |
| `--all-files`      | Use all tracked files instead of staged files              |
| `--from-ref <ref>` | Use files changed relative to `<ref>` (e.g. `origin/main`) |
| `--ci`             | Check-only mode, see [CI](#ci)                             |
| `--no-backup`      | Skip the pre-run backup (large repos)                      |
| `--no-revert`      | Keep task changes when a task fails                        |
| `--skip-tag <tag>` | Skip tasks with this tag                                   |

## Skipping

```bash
git commit --no-verify           # git's built-in skip
WARD=0 git commit                # disable Ward for one command
WARD_SKIP_TAGS=slow git commit   # skip tasks tagged "slow"
```

Hooks are skipped automatically while a merge or rebase is in progress.

## CI

The same config runs in CI:

```yaml
# .github/workflows/lint.yml
- run: npx ward run pre-commit --ci --from-ref origin/main
```

In CI mode Ward does not apply fixes: it runs the tasks, shows the diff of what would have been fixed, and fails if anything changed. On GitHub Actions, failures are reported as annotations on the changed lines.

## How it works (short)

`ward` writes a tiny stub for every git hook into `.git/hooks`. Each stub just calls `ward run <hook>`. The config is read **at run time**, so changes apply instantly. If a hook has no tasks, it exits immediately.

After a run Ward prints a report: timing per task, why a task failed, and a hint on how to fix it.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

## Comparison

|                               | husky + lint-staged | lefthook      | Ward |
| ----------------------------- | ------------------- | ------------- | ---- |
| Packages                      | 2                   | 1 (Go binary) | 1    |
| Hook folder in repo           | `.husky/`           | no            | no   |
| Typed TS config               | no                  | no            | yes  |
| Function tasks                | yes (lint-staged)   | no            | yes  |
| Config change needs reinstall | no                  | no            | no   |
| Partial staging safe          | yes                 | yes           | yes  |
| CI mode with same config      | no                  | partial       | yes  |

## License

[MIT](./LICENSE)
