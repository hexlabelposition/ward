import { execFileSync } from "node:child_process";

export type GitOptions = {
  /** Working directory for git. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Environment for git. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
};

/** Git exited with a non-zero status. */
export class GitError extends Error {
  readonly args: readonly string[];
  readonly status: number | null;
  readonly stderr: string;

  constructor(args: readonly string[], status: number | null, stderr: string) {
    super(`git ${args.join(" ")} failed (exit ${String(status)}): ${stderr}`);
    this.name = "GitError";
    this.args = args;
    this.status = status;
    this.stderr = stderr;
  }
}

/**
 * Run git synchronously and return stdout without the trailing newline.
 * Throws `GitError` on a non-zero exit; spawn errors (git not installed) are rethrown as is.
 */
export function git(args: readonly string[], options: GitOptions = {}): string {
  try {
    const stdout = execFileSync("git", args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return stdout.replace(/\r?\n$/, "");
  } catch (error) {
    if (isExitError(error)) {
      throw new GitError(args, error.status, String(error.stderr).trim());
    }
    throw error;
  }
}

function isExitError(
  error: unknown,
): error is { status: number | null; stderr: unknown } {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  );
}
