# ward

> Git hooks from one typed config. Tasks on staged files, safe partial staging, no hook folder in the repo. Node, Bun and Deno.

`@hexlabelposition/ward` runs your git hooks from a single config file and runs tasks on the files of a commit or a push.

- **One config for all hooks** - `ward.config.ts` (typed, with autocomplete), `ward.yml`, or a `"ward"` section in `package.json`
- **No hook folder in the repo** - hooks are generated locally into `.git/hooks`, only the config is committed
- **Tasks on staged files** - `eslint --fix {staged_files}`, with `glob` / `exclude` per task, fixes staged automatically
- **Safe with partial staging** - unstaged changes are hidden while tasks run, and a failed run is reverted from a backup
- **Careful with existing hooks** - a hook that is already there (git-lfs, a hand-written script) is never overwritten silently
- **Clear config errors** - every problem is listed with its place in the config and a suggestion for typos
- **Node, Bun and Deno** - installs with `npm`, `bun install` or a `deno.json` task, and `ward.config.ts` needs no loader on any of them

> ⚠️ Status: early versions. `0.x` releases may change the config and behavior. See [GitHub Releases](https://github.com/hexlabelposition/ward/releases) for what changed and [BACKLOG.md](./BACKLOG.md) for what is planned.

## Install

Requires Git ≥ 2.20 and Node ≥ 24, Bun or Deno 2. CI tests the latest Bun and Deno 2.x.

```bash
npm install -D @hexlabelposition/ward
npm pkg set scripts.prepare=ward
npm run prepare
```

The `prepare` script runs on every `npm install`, so hooks are set up for everyone on the team automatically. With Bun, `bun add -d @hexlabelposition/ward` and the same `prepare` script work: `bun install` runs it too, also in workspace packages.

With Deno, there is no `prepare` lifecycle: add a task and run it after cloning and after updating Ward.

```bash
deno add npm:@hexlabelposition/ward
```

```json
{
  "tasks": {
    "prepare": "deno run -A npm:@hexlabelposition/ward"
  }
}
```

```bash
deno task prepare
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
      "commit-msg": "npx commitlint --edit {1}",
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

If more than one is found, Ward stops with an error instead of silently picking one. Without a config every hook does nothing. Personal changes that should not be committed go in `ward.local.*` (see [Local overrides](#local-overrides)).

### TypeScript

```ts
// ward.config.ts
import { defineConfig } from "@hexlabelposition/ward";

export default defineConfig({
  hooks: {
    "pre-commit": {
      tasks: {
        eslint: {
          run: "npx eslint --fix {staged_files}",
          glob: "*.{js,ts}",
        },
        prettier: {
          run: "npx prettier --write --ignore-unknown {staged_files}",
        },
      },
    },
    "commit-msg": "npx commitlint --edit {1}",
    "pre-push": ["npm run typecheck", "npm test"],
  },
});
```

`defineConfig` gives types and autocomplete for hook names and options. The file is loaded by Node's built-in type stripping, with no extra loader, so keep it to erasable syntax: no `enum`, `namespace` or constructor parameter properties.

### YAML

```yaml
# ward.yml
hooks:
  pre-commit:
    tasks:
      eslint:
        run: npx eslint --fix {staged_files}
        glob: "*.{js,ts}"
      prettier:
        run: npx prettier --write --ignore-unknown {staged_files}
  commit-msg: npx commitlint --edit {1}
  pre-push:
    - npm run typecheck
    - npm test
```

### Editor autocomplete

`ward.config.ts` gets types and autocomplete from `defineConfig`. For `ward.yml` and the `"ward"` section of `package.json`, Ward ships a JSON Schema that completes hook names and options and marks unknown ones.

In `ward.yml`, point the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) at it with a comment on the first line:

```yaml
# yaml-language-server: $schema=./node_modules/@hexlabelposition/ward/schema.json
hooks:
  pre-commit: npm run lint
```

Without `node_modules` (Deno), use `https://unpkg.com/@hexlabelposition/ward/schema.json`. For `ward.local.yml`, use `local.schema.json` instead: it allows `null` and partial tasks.

For `package.json` in VS Code, add the schema in `.vscode/settings.json`. It is applied next to the usual `package.json` schema and only describes the `"ward"` key:

```json
{
  "json.schemas": [
    {
      "fileMatch": ["package.json"],
      "url": "./node_modules/@hexlabelposition/ward/package.schema.json"
    }
  ]
}
```

In JetBrains IDEs, map `schema.json` to `ward.yml` (and `local.schema.json` to `ward.local.yml`) in Settings | Languages & Frameworks | Schemas and DTDs | JSON Schema Mappings.

The schema checks the shape of the config. Rules that depend on the hook, such as `{push_files}` outside `pre-push`, and pattern syntax are checked by Ward when a hook runs (see [Config errors](#config-errors)).

### Hook value forms

| Form                                  | Meaning                                       |
| ------------------------------------- | --------------------------------------------- |
| `"cmd"`                               | Run one command                               |
| `["a", "b"]`                          | Run commands in order, stop on first failure  |
| `{ tasks: { name: { run: "cmd" } } }` | Named tasks, run in the order they are listed |

Any [git hook](https://git-scm.com/docs/githooks) can be used as a key: `pre-commit`, `commit-msg`, `pre-push`, `post-checkout`, `post-merge` and so on. Hook names can also be written in camelCase, which needs no quotes in `ward.config.ts`: `preCommit`, `commitMsg`, `prePush`. Writing the same hook both ways is an error.

### How tasks run

- Commands run through the system shell from the repo root, so `&&`, pipes and `npm run …` work as in a terminal.
- `node_modules/.bin` is not added to `PATH`: call local tools with `npx` or through `npm run`.
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
  commit-msg: npx commitlint --edit {1}
  prepare-commit-msg: node scripts/prefill-message.js {1} {2}
```

Values are quoted for the shell when needed, so write `{1}`, not `"{1}"`. An argument git did not pass expands to nothing.

## Tasks on files

### File placeholders

| Placeholder      | Files                                                          |
| ---------------- | -------------------------------------------------------------- |
| `{staged_files}` | Files staged for the commit (added, copied, modified, renamed) |
| `{push_files}`   | Files changed by the commits being pushed, `pre-push` only     |
| `{all_files}`    | All tracked files                                              |

Paths are relative to the repo root and quoted for the shell, so spaces and other special characters are safe. A task whose placeholders get no files is skipped, so `eslint {staged_files}` never runs on the whole project. A long list is split into several runs of the command, so it fits the command line limit on Windows.

### `glob` and `exclude`

```yaml
hooks:
  pre-commit:
    tasks:
      eslint:
        run: npx eslint --fix {staged_files}
        glob: ["*.ts", "*.tsx"]
        exclude: "src/generated/**"
```

- A pattern without `/` matches the file name in any directory (`*.ts`), one with `/` matches the path from the repo root (`src/**/*.ts`), as in `.gitignore`.
- `glob` and `exclude` take one pattern or a list.
- A task with `glob` and no placeholder (`npx tsc --noEmit`) runs only when one of the hook's files matches: staged files in `pre-commit`, pushed files in `pre-push`.

### Task options

| Option       | Default | Meaning                                                                                              |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| `run`        | -       | Command, or a function in `ward.config.ts`                                                           |
| `glob`       | all     | Files the task runs on                                                                               |
| `exclude`    | none    | Files to leave out even when `glob` matches them                                                     |
| `symlinks`   | `false` | Pass symlinks to the task too. Off by default: a formatter would rewrite the file the link points to |
| `stageFixed` | `true`  | `git add` the staged files the task changed, so a formatter's fixes go into the commit               |

### Function tasks

In `ward.config.ts`, `run` can be a function. It runs in Ward's process and gets the task's files (after `glob` / `exclude`) and the hook arguments. The task fails when the function throws or its promise rejects.

```ts
import { readFileSync } from "node:fs";
import { defineConfig } from "@hexlabelposition/ward";

export default defineConfig({
  hooks: {
    "pre-commit": {
      tasks: {
        "no-only": {
          glob: "*.test.ts",
          run({ files }) {
            const bad = files.filter((file) =>
              readFileSync(file, "utf8").includes(".only("),
            );
            if (bad.length > 0) {
              throw new Error(`.only() left in ${bad.join(", ")}`);
            }
          },
        },
      },
    },
  },
});
```

`files` holds staged files in `pre-commit`, pushed files in `pre-push` and nothing in other hooks.

### Parallel tasks

```yaml
hooks:
  pre-push:
    parallel: true
    tasks:
      typecheck:
        run: npm run typecheck
      test:
        run: npm test
```

With `parallel: true` all tasks start at once and each runs to the end; the hook fails if any of them fails. Every line of output is prefixed with the task name. Don't run tasks that write the same files in parallel, such as ESLint `--fix` and Prettier.

## Safety

When a hook with tasks runs, Ward protects your working changes:

1. **Backup.** Before the first task, the index and working tree are saved with `git stash create`. While the hook runs, the backup is also in `git stash list` as "ward backup", so a killed run can be restored by hand; it is kept there if the revert does not happen or fails.
2. **Partial staging.** When tasks get staged files, the unstaged changes of partially staged files are hidden, so tasks see exactly what will be committed. They are put back after the tasks.
3. **Revert.** When a task fails, or the unstaged changes conflict with a task's fixes, the index and working tree go back to the backup.
4. **Empty commit.** If the tasks undo every staged change in `pre-commit` (a formatter reverts a whitespace-only change), the hook fails instead of making an empty commit.

Untracked files are not touched. Binary files, renames, deletions and symlinks are handled.

| Hook option | Flag          | Meaning                                                                |
| ----------- | ------------- | ---------------------------------------------------------------------- |
| `backup`    | `--no-backup` | `false` skips the backup to save time in large repos; no revert then   |
| `revert`    | `--no-revert` | `false` keeps the changes of the tasks after a failure, for inspection |

The flags are for `ward run`, right after the hook name: `ward run pre-commit --no-revert`.

## Local overrides

`ward.local.ts`, `ward.local.yml` or `ward.local.yaml` in the repo root is merged on top of the main config. Use it for changes only you want: skip a slow hook, add a task, narrow a `glob`. Add `ward.local.*` to `.gitignore`.

```yaml
# ward.local.yml
hooks:
  pre-push: null # remove the hook
  pre-commit:
    parallel: false
    tasks:
      eslint:
        glob: "src/**/*.ts" # only this option changes, `run` stays
      prettier: null # remove the task
      spellcheck: # a new task runs after the others
        run: npx cspell {staged_files}
```

- Hooks are matched by the hook they name, so `prePush` changes `pre-push`.
- A command or a list of commands replaces the hook. `null` removes it.
- `{ tasks }` is merged into a hook with tasks: hook options override, tasks are matched by name and their options replaced one by one. A task keeps its place, new tasks run last, `null` removes one. Over a hook written as a command or a list, or a hook the main config does not have, it is used as is and needs a `run` for every task.
- `null` for a hook or task the main config does not have is an error, since it is most likely a typo.
- It works without a main config too, as a config only you use.

`ward.local.ts` gets types from `defineLocalConfig`:

```ts
// ward.local.ts
import { defineLocalConfig } from "@hexlabelposition/ward";

export default defineLocalConfig({
  hooks: {
    prePush: null,
  },
});
```

Both files are checked on their own first, and the merged config after that. Problems that come from the merge, such as a new task without `run`, name both files: `ward.yml + ward.local.yml is invalid`. If there are several local files, Ward stops with an error, as for the main config.

## Config errors

The whole config is checked on every run, and every problem is reported at once:

```text
$ git commit -m "fix: typo"
ward: ward.yml is invalid:
  hooks.pre-comit: unknown hook. Did you mean "pre-commit"?
  hooks.pre-push[1]: command is empty
```

An invalid config fails every hook, not only the broken one: a typo in a hook name would otherwise never be noticed. Options planned for later versions are rejected with "not supported yet" instead of being silently ignored.

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
| `--bin <path>`         | Binary the hooks call instead of `node_modules/.bin/ward`      |

`ward run` flags, given right after the hook name:

| Flag               | Meaning                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `--no-backup`      | Skip the backup before the run (see [Safety](#safety))                        |
| `--no-revert`      | Keep the changes of the tasks when the hook fails                             |
| `--from-ref <ref>` | Run on the files changed since `<ref>` instead of the staged or pushed ones   |
| `--all-files`      | Run on every tracked file instead of the staged or pushed ones                |
| `--ci`             | Check without keeping fixes: show the diff, restore the tree, fail on changes |

`--from-ref` runs the same config on a branch, for example in a pull request pipeline: `ward run pre-commit --from-ref origin/main`. `{staged_files}`, `{push_files}` and `glob`-only tasks get the files the branch changed since it forked from `<ref>`; uncommitted changes are not included, and fixes are not staged. The ref and the history down to the fork must be in the clone: with `actions/checkout`, set `fetch-depth: 0`.

`--all-files` does the same with every file git tracks, for a full check: `ward run pre-commit --all-files`. Use one of the two flags, not both.

### CI

`--ci` runs the same hooks as a check in a pipeline. The tasks run as usual, but their fixes are not kept: Ward prints the diff of every file they changed and the files they created, puts the tree back as it was and fails when anything changed. A task that fails fails the hook with its own exit code. `--ci` needs `--from-ref` or `--all-files`, since nothing is staged in CI, and it always backs up and restores the tree, whatever `backup` and `revert` say.

```yaml
# .github/workflows/ci.yml, in a pull request job
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: npm ci
- run: npx ward run pre-commit --ci --from-ref origin/${{ github.base_ref }}
```

`npm ci` does not install the hooks there (`CI` is set), and the check fails with the command that applies the fixes locally.

In GitHub Actions (`GITHUB_ACTIONS=true`), Ward also prints failures as annotations: a failed task, and with `--ci` every block of lines the tasks would change, shown on those lines in the pull request's "Files changed" tab. GitHub shows up to 10 error annotations per step; the full diff is always in the log.

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

## Moving from lint-staged

Each lint-staged entry becomes a task with `glob` and `{staged_files}`. This lint-staged config:

```json
{
  "lint-staged": {
    "*.{js,ts}": "eslint --fix",
    "*": "prettier --write --ignore-unknown"
  }
}
```

becomes:

```yaml
# ward.yml
hooks:
  pre-commit:
    tasks:
      eslint:
        run: npx eslint --fix {staged_files}
        glob: "*.{js,ts}"
      prettier:
        run: npx prettier --write --ignore-unknown {staged_files}
```

Then remove `lint-staged` and the `npx lint-staged` call from the `pre-commit` hook. Differences to keep in mind:

- Ward does not append the files to the command: write `{staged_files}` where they go.
- Tasks run one after another unless the hook sets `parallel: true`; lint-staged runs different globs in parallel.
- Fixed files are staged by default, as in lint-staged; `stageFixed: false` turns it off per task.

## How it works

`ward` writes a small stub for every git hook into `.git/hooks`. Each stub only calls `ward run <hook>`. The config is read at run time, so changes apply on the next git command, with no reinstall. A hook with no tasks exits right away, before anything else is loaded.

Stubs start Ward on the runtime that ran the install. `bun install` starts `prepare` through the binary's `node` shebang, so hooks run on Node when it is installed and on Bun when it is not. Installed from Deno, hooks run `deno run -A npm:@hexlabelposition/ward`, at the version from `deno.json` or `package.json`. `WARD_RUNTIME=node`, `bun` or `deno` overrides it, for example `WARD_RUNTIME=node git commit`.

`.git/hooks` is not committed, so each clone generates its own stubs through `prepare`. The hooks directory is resolved by git itself, so worktrees and submodules work.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design and the details of each part.

## Roadmap

Planned versions and items are in [BACKLOG.md](./BACKLOG.md), released changes on [GitHub Releases](https://github.com/hexlabelposition/ward/releases).

## License

[MIT](./LICENSE)
