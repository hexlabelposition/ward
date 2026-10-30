import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type TempRepo = {
  /** Absolute path to the repo root (symlinks and Windows short names resolved). */
  dir: string;
  /** Run git in the repo and return trimmed stdout. */
  git: (...args: string[]) => string;
  /** Write a file relative to the repo root, creating parent dirs. */
  write: (path: string, content: string) => void;
  /** Write files, `git add` them and commit. */
  commit: (message: string, files?: Record<string, string>) => void;
  [Symbol.dispose]: () => void;
};

type Options = {
  /** Skip `git init` to get a plain directory outside any repo. */
  init?: boolean;
};

/**
 * Create a git repo in a fresh temp dir. Use with `using` so it is removed
 * after the test: `using repo = createTempRepo();`
 */
export function createTempRepo({ init = true }: Options = {}): TempRepo {
  // `.native` also expands Windows 8.3 short names (RUNNER~1 → runneradmin), like git does.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ward-test-")));

  // Isolate from the developer's global/system git config (hooksPath, signing, templates).
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(dir, ".gitconfig-global"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Ward Test",
    GIT_AUTHOR_EMAIL: "test@ward.invalid",
    GIT_COMMITTER_NAME: "Ward Test",
    GIT_COMMITTER_EMAIL: "test@ward.invalid",
  };

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();

  const write = (path: string, content: string) => {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };

  const commit = (message: string, files: Record<string, string> = {}) => {
    for (const [path, content] of Object.entries(files)) write(path, content);
    git("add", "--all");
    git("commit", "--allow-empty", "--no-verify", "-m", message);
  };

  if (init) {
    git("init", "--quiet", "--initial-branch=main");
    git("config", "commit.gpgsign", "false");
  }

  return {
    dir,
    git,
    write,
    commit,
    [Symbol.dispose]: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
