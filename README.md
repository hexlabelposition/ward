# ward

> Git hooks and staged-file linting in one tool. One config, zero hook folders.

`@hexlabelposition/ward` replaces the **husky + lint-staged** combo with a single package:

- **One config file** - `ward.config.ts` (typed, with autocomplete) or `ward.yml`
- **No `.husky/`-style folder** in your repo - hooks are generated locally into `.git/hooks`
- **Dynamic** - edit the config and the change applies on the next commit, no reinstall
- **Staged-files aware** - run commands only on the files you are committing
- **Safe with partial staging** - unstaged changes are stashed and restored automatically

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

`init` creates a starter `ward.config.ts` and adds a `prepare` script to `package.json`:

```json
{
  "scripts": {
    "prepare": "ward install"
  }
}
```

After that, every `npm install` (or `bun install`) sets up the hooks for everyone on the team automatically.

### Runtimes

| Runtime   | Status                                                              |
| --------- | ------------------------------------------------------------------- |
| Node ≥ 18 | Supported                                                           |
| Bun ≥ 1.1 | Supported - works without Node installed, TS config loaded natively |
| Deno      | Planned                                                             |

## Configuration

### TypeScript

```ts
// ward.config.ts
import { defineConfig } from "@hexlabelposition/ward";

export default defineConfig({
  hooks: {
    "pre-commit": {
      staged: {
        "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
        "*.{css,md,json}": "prettier --write",
      },
    },
    "commit-msg": "commitlint --edit {1}",
    "pre-push": ["npm run typecheck", "npm test"],
  },
});
```

### YAML

```yaml
# ward.yml
hooks:
  pre-commit:
    staged:
      "*.{ts,tsx}":
        - eslint --fix
        - prettier --write
      "*.{css,md,json}": prettier --write
  commit-msg: commitlint --edit {1}
  pre-push:
    - npm run typecheck
    - npm test
```

### Hook value forms

| Form                         | Meaning                                         |
| ---------------------------- | ----------------------------------------------- |
| `'cmd'`                      | Run one command                                 |
| `['a', 'b']`                 | Run commands in order, stop on first failure    |
| `{ run: [...] }`             | Same as array, with extra options               |
| `{ staged: { glob: cmds } }` | Run commands on staged files matching each glob |

### Placeholders

| Placeholder    | Value                                                                       |
| -------------- | --------------------------------------------------------------------------- |
| `{files}`      | Matching staged files (appended automatically if omitted in `staged` tasks) |
| `{1}`, `{2}` … | Arguments git passed to the hook (e.g. commit message file)                 |

### Options

```ts
'pre-commit': {
  parallel: true,        // run glob groups in parallel
  stash: true,           // stash unstaged changes (default: true)
  staged: { ... },
}
```

## CLI

| Command           | What it does                                                |
| ----------------- | ----------------------------------------------------------- |
| `ward init`       | Create config and `prepare` script (run once)               |
| `ward install`    | Write hook stubs into `.git/hooks` (runs via `prepare`)     |
| `ward run <hook>` | Run a hook manually - useful for testing without committing |
| `ward uninstall`  | Remove Ward's hook stubs                                    |

## Skipping hooks

```bash
git commit --no-verify  # git's built-in skip
WARD=0 git commit       # disable Ward for one command
```

## How it works (short)

`ward install` writes a tiny stub for every git hook into `.git/hooks`. Each stub just calls `ward run <hook>`. The config is read **at run time**, so changes apply instantly. If a hook has no tasks, it exits immediately.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

## Comparison

|                               | husky + lint-staged | lefthook      | Ward |
| ----------------------------- | ------------------- | ------------- | ---- |
| Packages                      | 2                   | 1 (Go binary) | 1    |
| Hook folder in repo           | `.husky/`           | no            | no   |
| Typed TS config               | no                  | no            | yes  |
| Config change needs reinstall | no                  | no            | no   |
| Partial staging safe          | yes                 | yes           | yes  |

## License

[MIT](./LICENSE)
