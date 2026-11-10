import { git, GitError, type GitOptions } from "./exec.ts";

export type ConfigEntry = {
  value: string;
  /**
   * Where the value comes from: `local`, `global`, `system`, `worktree` or
   * `command` (`git -c`, `GIT_CONFIG_*`). `null` if git is too old to say (< 2.26).
   */
  scope: string | null;
};

/** The effective value of a config key, or `null` if it is not set. */
export function getConfig(
  key: string,
  options: GitOptions = {},
): ConfigEntry | null {
  try {
    const out = git(["config", "--show-scope", "--get", key], options);
    const tab = out.indexOf("\t");
    return tab === -1
      ? { value: out, scope: null }
      : { value: out.slice(tab + 1), scope: out.slice(0, tab) };
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    // 1: the key is not set.
    if (error.status === 1) return null;
  }
  // `--show-scope` is unknown before git 2.26.
  try {
    return { value: git(["config", "--get", key], options), scope: null };
  } catch (error) {
    if (error instanceof GitError && error.status === 1) return null;
    throw error;
  }
}
