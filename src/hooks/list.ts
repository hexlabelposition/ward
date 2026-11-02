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

const hookSet: ReadonlySet<string> = new Set(HOOKS);

export function isHookName(name: string): name is HookName {
  return hookSet.has(name);
}
