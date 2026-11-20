/**
 * Git hooks Ward writes stubs for and accepts in the config, in the order of `man githooks`.
 *
 * Left out on purpose:
 * - `reference-transaction`, `post-index-change`: fire on every ref / index update,
 *   so a stub would start Node several times per `git commit` (may return after W56).
 * - `fsmonitor-watchman`: not an event hook - git talks a protocol to it via `core.fsmonitor`.
 * - Server-side (`pre-receive`, `update`, `proc-receive`, `post-receive`, `post-update`,
 *   `push-to-checkout`): run in the repo being pushed to, not in a developer clone.
 * - `p4-*`: git-p4 only.
 */
export const HOOKS = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
] as const;

export type HookName = (typeof HOOKS)[number];

/** `pre-commit` → `preCommit`. */
type CamelCase<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : S;

/** The camelCase spelling the config accepts next to the git name: `preCommit`. */
export type CamelHookName = CamelCase<HookName>;

function toCamel(hook: HookName): CamelHookName {
  return hook.replace(/-(\w)/g, (_, char: string) =>
    char.toUpperCase(),
  ) as CamelHookName;
}

/** camelCase names in the order of `HOOKS`. */
export const CAMEL_HOOKS: readonly CamelHookName[] = HOOKS.map(toCamel);

const byKey: ReadonlyMap<string, HookName> = new Map(
  HOOKS.flatMap((hook) => [
    [hook, hook],
    [toCamel(hook), hook],
  ]),
);

const hookSet: ReadonlySet<string> = new Set(HOOKS);

export function isHookName(name: string): name is HookName {
  return hookSet.has(name);
}

/** The git hook a config key names, as `pre-commit` or `preCommit`. */
export function resolveHookName(key: string): HookName | undefined {
  return byKey.get(key);
}
