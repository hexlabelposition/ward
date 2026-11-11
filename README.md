# ward

> Git hooks from one config. No hook folder in your repo.

`@hexlabelposition/ward` runs your git hooks from a single config file. Version 0.1 replaces **husky**; running tasks on staged files (the **lint-staged** part) comes in 0.2.

- **One config for all hooks** - `ward.config.ts` (typed, with autocomplete), `ward.yml`, or a `"ward"` section in `package.json`
- **No `.husky/`-style folder** - hooks are generated locally into `.git/hooks`, only the config is committed
- **Dynamic** - edit the config and the change applies on the next commit, no reinstall
- **Careful with existing hooks** - a hook that is already there (git-lfs, a hand-written script) is never overwritten silently
- **Clear config errors** - every problem is listed with its place in the config and a suggestion for typos

> ⚠️ Status: early versions. `0.x` releases may change the config and behavior. See [What's next](#whats-next) for planned features.

## Install

Requires Node ≥ 24 and Git ≥ 2.20.

```bash
npm install -D @hexlabelposition/ward
npm pkg set scripts.prepare=ward
npm run prepare
```

The `prepare` script runs on every `npm install`, so hooks are set up for everyone on the team automatically:

```json
{
  "scripts": {
    "prepare": "ward"
  }
}
```

Then add a config. The shortest one lives in `package.json`:

```json
{
  "scripts": {
    "prepare": "ward"
  },
  "ward": {
    "hooks": {
      "pre-commit": "npm run lint",
      "commit-msg": "commitlint --edit {1}",
      "pre-push": ["npm run typecheck", "npm test"]
    }
  }
}
```

That's all: `git commit` now runs `npm run lint` and stops the commit if it fails.

## Configuration

Ward looks for the config in the repo root, in this order:

1. `ward.config.ts`
2. `ward.yml` / `ward.yaml`
3. `"ward"` section in `package.json`

If more than one is found, Ward stops with an error instead of silently picking one. Without a config every hook does nothing.

### TypeScript

```ts
// ward.config.ts
import { defineConfig } from "@hexlabelposition/ward";

export default defineConfig({
  hooks: {
    "pre-commit": ["npm run lint", "npm run format:check"],
    "commit-msg": "commitlint --edit {1}",
    "pre-push": {
      tasks: {
        typecheck: { run: "npm run typecheck" },
        test: { run: "npm test" },
      },
    },
  },
});
```

`defineConfig` gives types and autocomplete for hook names and options. The file is loaded by Node's built-in type stripping, with no extra loader, so keep it to erasable syntax: no `enum`, `namespace` or constructor parameter properties.

### YAML

```yaml
# ward.yml
hooks:
  pre-commit:
    - npm run lint
    - npm run format:check
  commit-msg: commitlint --edit {1}
  pre-push:
    tasks:
      typecheck:
        run: npm run typecheck
      test:
        run: npm test
```

### Hook value forms

| Form                                  | Meaning                                       |
| ------------------------------------- | --------------------------------------------- |
| `"cmd"`                               | Run one command                               |
| `["a", "b"]`                          | Run commands in order, stop on first failure  |
| `{ tasks: { name: { run: "cmd" } } }` | Named tasks, run in the order they are listed |

Any [git hook](https://git-scm.com/docs/githooks) can be used as a key: `pre-commit`, `commit-msg`, `pre-push`, `post-checkout`, `post-merge` and so on.

### How tasks run

- Commands run through the system shell from the repo root, so `&&`, pipes and `npm run …` work as in a terminal.
- Tasks run one after another. The first one that fails stops the hook, and git gets its exit code:

  ```text
  $ git commit -m "feat: add login"
  … output of npm run lint …
  ward: pre-commit failed: npm run lint (exit 1)
  ```

- Output is not captured: you see what the command prints, as it prints it.
- Hooks that get data from git on stdin (`pre-push`) pass it on to the command.

### Hook arguments

`{1}`, `{2}`, … are replaced with the arguments git passed to the hook. For `commit-msg`, `{1}` is the file with the commit message:

```yaml
hooks:
  commit-msg: commitlint --edit {1}
  prepare-commit-msg: node scripts/prefill-message.js {1} {2}
```

Values are quoted for the shell when needed, so write `{1}`, not `"{1}"`. An argument git did not pass expands to nothing.

### Config errors

The whole config is checked on every run, and every problem is reported at once:

```text
$ git commit -m "fix: typo"
ward: ward.yml is invalid:
  hooks.pre-comit: unknown hook. Did you mean "pre-commit"?
  hooks.pre-push[1]: command is empty
```

An invalid config fails every hook, not only the broken one: a typo in a hook name would otherwise never be noticed.

## CLI

| Command           | What it does                                                |
| ----------------- | ----------------------------------------------------------- |
| `ward`            | Install hook stubs into `.git/hooks` (what `prepare` runs)  |
| `ward run <hook>` | Run a hook manually - useful for testing without committing |
| `ward uninstall`  | Remove Ward's hook stubs, put chained hooks back            |

`ward` flags:

| Flag                   | Meaning                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `--chain`              | Keep existing hooks and run Ward after them                    |
| `--force`              | Replace existing hooks; the old ones are lost                  |
| `--respect-hooks-path` | Install into the `core.hooksPath` directory instead of failing |

`ward` does nothing in CI (when `CI` is set), outside a git repository and when git is not installed, so `npm install` in Docker or CI does not fail.

### Existing hooks

If a hook file that Ward did not write is already in `.git/hooks`, Ward leaves it alone:

- In a terminal, `npx ward` lists such hooks and asks whether to keep them.
- From `prepare`, it prints a warning with the command to run and does not fail the install.
- `npx ward --chain` keeps them without asking: the old hook is renamed to `<hook>.pre-ward` and runs before Ward with the same arguments. If it fails, git stops and Ward does not run.
- `npx ward --force` replaces them.

`ward uninstall` removes only Ward's own stubs and moves each `<hook>.pre-ward` back to its place.

### `core.hooksPath`

When `core.hooksPath` is set, git ignores `.git/hooks`, so Ward's hooks would never run. Ward stops with a message that names the value, where it is set and the command that removes it. To install into that directory instead, run `ward --respect-hooks-path`.

## Skipping

```bash
git commit --no-verify   # git's built-in skip: no hooks at all
WARD=0 git commit        # disable Ward for one command
```

`WARD=0` skips only Ward: a hook that was there before Ward and is chained from the stub still runs.

Hooks are skipped automatically while a merge or rebase is in progress: the commits git makes there are not your working changes.

If dependencies are not installed yet (`node_modules/.bin/ward` is missing), the hook prints a warning and lets git continue.

## Moving from husky

1. Remove husky and install Ward:

   ```bash
   npm uninstall husky
   npm install -D @hexlabelposition/ward
   npm pkg set scripts.prepare=ward
   ```

2. Move the commands from `.husky/*` into the config. A `.husky/pre-commit` with `npm test` and a `.husky/commit-msg` with `npx commitlint --edit $1` become:

   ```yaml
   # ward.yml
   hooks:
     pre-commit: npm test
     commit-msg: npx commitlint --edit {1}
   ```

3. Delete the `.husky/` folder and unset the hooks path husky configured, then install the hooks:

   ```bash
   git config --unset core.hooksPath
   npm run prepare
   ```

   Each teammate needs the `git config --unset` once in their clone; Ward prints this command when it finds the setting.

## How it works

`ward` writes a small stub for every git hook into `.git/hooks`. Each stub only calls `ward run <hook>`. The config is read at run time, so changes apply on the next git command. A hook with no tasks exits right away, before anything else is loaded.

`.git/hooks` is not committed, so each clone generates its own stubs through `prepare`. The hooks directory is resolved by git itself, so worktrees and submodules work.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

## What's next

Planned, not available yet (see [BACKLOG.md](./BACKLOG.md)):

- **0.2 - replace lint-staged**: tasks on staged files with `glob` and `{staged_files}`, safe partial staging with backup, parallel tasks
- **0.3**: Bun and Deno
- Later: `ward init`, CI mode, presets and shared configs, monorepo support, migration from husky + lint-staged and lefthook

Options from these versions (`glob`, `parallel`, …) are rejected today with "not supported yet" instead of being silently ignored.

## License

[MIT](./LICENSE)
