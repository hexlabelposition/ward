import { HOOKS, type HookName, toCamel } from "../hooks/list.ts";

/**
 * JSON Schema for `ward.yml` and the `"ward"` section of `package.json`, so
 * editors complete hook names and options. Not used at run time:
 * `bun run schema` writes it to `schema.json` and `package.schema.json`, and
 * a test checks the files and `schema.ts` agree with it.
 *
 * It covers the shape of the config. Rules that depend on the hook
 * (`{push_files}` outside `pre-push`, `glob` without files) and pattern
 * syntax are left to `validateConfig`, which runs on every `ward run`.
 */

/** Shown next to each hook name in the editor. */
const HOOK_DESCRIPTIONS: Readonly<Record<HookName, string>> = {
  "applypatch-msg":
    "`git am`, before a patch is applied. `{1}` is the file with the proposed commit message.",
  "pre-applypatch":
    "`git am`, after a patch is applied and before it is committed.",
  "post-applypatch": "`git am`, after a patch is committed.",
  "pre-commit":
    "`git commit`, before the commit message is asked for. Tasks get the staged files.",
  "pre-merge-commit": "`git merge`, before a merge commit is created.",
  "prepare-commit-msg":
    "`git commit`, before the message editor opens. `{1}` is the message file, `{2}` the message source.",
  "commit-msg":
    "`git commit`, after the message is written. `{1}` is the message file.",
  "post-commit": "`git commit`, after the commit is created.",
  "pre-rebase": "`git rebase`, before it starts. `{1}` is the upstream.",
  "post-checkout":
    "`git checkout` / `git switch`, after the worktree is updated. `{1}` previous HEAD, `{2}` new HEAD, `{3}` 1 for a branch checkout.",
  "post-merge": "`git merge` / `git pull`, after a merge.",
  "pre-push":
    "`git push`, before anything is pushed. Tasks get the files of the pushed commits. `{1}` remote name, `{2}` URL.",
  "pre-auto-gc": "`git gc --auto`, before it runs.",
  "post-rewrite":
    "`git commit --amend` / `git rebase`, after commits are rewritten. `{1}` is the command.",
  "sendemail-validate":
    "`git send-email`, for each patch. `{1}` is the patch file.",
};

const BOOLEAN_OPTIONS = {
  parallel: {
    default: false,
    description:
      "Start all tasks at once and let each run to the end; the hook fails if any of them fails. Tasks run one after another by default.",
  },
  backup: {
    default: true,
    description:
      "Save the index and working tree with `git stash create` before the run, so they can be restored if a task breaks them. `false` skips it to save time in large repos.",
  },
  revert: {
    default: true,
    description:
      "When a task fails, put the index and working tree back as they were before the run, from the backup. `false` keeps the tasks' changes for inspection. Needs `backup`.",
  },
  symlinks: {
    default: false,
    description:
      "Pass symlinks to the task too. Off by default: a formatter would rewrite the file the link points to.",
  },
  stageFixed: {
    default: true,
    description:
      "`git add` the staged files the task changed, so a formatter's fixes go into the commit. `false` leaves them unstaged.",
  },
} as const;

function boolean(key: keyof typeof BOOLEAN_OPTIONS) {
  return { type: "boolean", ...BOOLEAN_OPTIONS[key] };
}

/** `"*.ts"` or `["*.ts", "*.tsx"]`. */
function patterns(description: string) {
  return {
    description,
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
  };
}

const HOOK_REF = { $ref: "#/definitions/hook" };

/**
 * The schema for the config object itself: `ward.yml`, or with `local`
 * `ward.local.yml`, where hooks and tasks may be `null` (removed) and a
 * task or hook may leave out what the main config already has.
 */
export function buildConfigSchema({ local = false } = {}) {
  // Local overrides are merged into the main config, so nothing is required.
  const required = (keys: string[]) => (local ? {} : { required: keys });
  const orNull = (schema: object, description: string) =>
    local ? { anyOf: [schema, { type: "null", description }] } : schema;

  const hookProperties: Record<string, unknown> = {};
  for (const hook of HOOKS) {
    const description = HOOK_DESCRIPTIONS[hook];
    // Draft-07 ignores keys next to `$ref`, so the description wraps it.
    hookProperties[hook] = { description, allOf: [HOOK_REF] };
    hookProperties[toCamel(hook)] = {
      description: `${description} Same as \`${hook}\`.`,
      allOf: [HOOK_REF],
    };
  }

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: local ? "Ward local config" : "Ward config",
    description: local
      ? "Contents of `ward.local.yml`: personal overrides merged on top of the main config, not committed. https://github.com/hexlabelposition/ward#local-overrides"
      : 'Contents of `ward.yml` or the `"ward"` section of `package.json`. https://github.com/hexlabelposition/ward#configuration',
    type: "object",
    properties: {
      hooks: {
        description: local
          ? "Hooks to change, add or remove (`null`). A command or a list replaces the hook, `{ tasks }` is merged into it by task name."
          : "Hooks without an entry are a no-op. A hook can be named as in git (`pre-commit`) or in camelCase (`preCommit`), not both.",
        type: "object",
        properties: hookProperties,
        additionalProperties: false,
        // The same hook in both spellings.
        dependencies: Object.fromEntries(
          HOOKS.map((hook) => [hook, { not: { required: [toCamel(hook)] } }]),
        ),
      },
    },
    additionalProperties: false,
    definitions: {
      command: {
        description:
          "Shell command, run from the repo root. `{1}`, `{2}` … are git hook arguments; `{staged_files}`, `{push_files}` (`pre-push` only) and `{all_files}` are files.",
        type: "string",
        pattern: "\\S",
      },
      hook: {
        description:
          'What the hook runs: one command, a list of commands run in order (stop on the first failure), or `{ tasks: { name: { run: "…" } } }`.',
        anyOf: [
          { $ref: "#/definitions/command" },
          { type: "array", items: { $ref: "#/definitions/command" } },
          { $ref: "#/definitions/hookTasks" },
          ...(local ? [{ type: "null", description: "Remove the hook." }] : []),
        ],
      },
      hookTasks: {
        type: "object",
        properties: {
          tasks: {
            description: "Named tasks, run in the order they are listed.",
            type: "object",
            propertyNames: { pattern: "\\S" },
            additionalProperties: orNull(
              { $ref: "#/definitions/task" },
              "Remove the task.",
            ),
          },
          parallel: boolean("parallel"),
          backup: boolean("backup"),
          revert: boolean("revert"),
        },
        ...required(["tasks"]),
        additionalProperties: false,
      },
      task: {
        type: "object",
        properties: {
          run: { $ref: "#/definitions/command" },
          glob: patterns(
            'Files the task runs on: one pattern or a list, any of them may match. A pattern without `/` matches the file name in any directory (`"*.ts"`), one with `/` the path from the repo root.',
          ),
          exclude: patterns(
            "Files to leave out even when `glob` matches them, same pattern rules.",
          ),
          symlinks: boolean("symlinks"),
          stageFixed: boolean("stageFixed"),
        },
        ...required(["run"]),
        additionalProperties: false,
      },
    },
  };
}

/**
 * For `package.json`: points the `"ward"` key at `schema.json`. Editors
 * combine it with the usual `package.json` schema.
 */
export function buildPackageSchema() {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: 'Ward config in package.json "ward"',
    type: "object",
    properties: {
      ward: {
        description:
          "Ward config: git hooks and the tasks they run. https://github.com/hexlabelposition/ward#configuration",
        allOf: [{ $ref: "./schema.json" }],
      },
    },
  };
}
