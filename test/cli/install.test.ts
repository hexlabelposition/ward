import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HOOKS } from "../../src/hooks/list.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

function ward(repo: TempRepo, args: string[] = [], cwd = repo.dir) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [CLI, ...args],
    { cwd, env: repo.env, encoding: "utf8" },
  );
  return { status, stdout, stderr };
}

function hook(repo: TempRepo, name: string) {
  return readFileSync(join(repo.dir, ".git", "hooks", name), "utf8");
}

describe("ward (install)", () => {
  it("installs stubs for all hooks", () => {
    using repo = createTempRepo();

    const { status, stdout } = ward(repo);

    expect(status).toBe(0);
    expect(stdout).toContain(
      `${String(HOOKS.length)} hooks installed in .git/hooks`,
    );
    for (const name of HOOKS) {
      expect(hook(repo, name)).toContain("bin='node_modules/.bin/ward'");
    }
  });

  it("reports up-to-date and updated stubs on reinstall", () => {
    using repo = createTempRepo();
    ward(repo);
    expect(ward(repo).stdout).toContain("(up to date)");

    repo.write(".git/hooks/pre-push", "#!/bin/sh\n# ward:managed v0\n");
    expect(ward(repo).stdout).toContain("(1 updated)");
  });

  it("finds a hoisted bin from a workspace package", () => {
    using repo = createTempRepo();
    repo.write("node_modules/.bin/ward", "");
    repo.write("packages/a/package.json", "{}");

    expect(ward(repo, [], join(repo.dir, "packages/a")).status).toBe(0);
    expect(hook(repo, "pre-commit")).toContain("bin='node_modules/.bin/ward'");
  });

  it("prefers the package's own bin", () => {
    using repo = createTempRepo();
    repo.write("node_modules/.bin/ward", "");
    repo.write("packages/a/node_modules/.bin/ward", "");

    ward(repo, [], join(repo.dir, "packages/a"));

    expect(hook(repo, "pre-commit")).toContain(
      "bin='packages/a/node_modules/.bin/ward'",
    );
  });

  it("warns about foreign hooks and keeps them", () => {
    using repo = createTempRepo();
    repo.write(".git/hooks/pre-commit", "#!/bin/sh\necho mine\n");

    const { status, stderr } = ward(repo);

    expect(status).toBe(0);
    expect(stderr).toContain("pre-commit exists and is not managed by ward");
    expect(hook(repo, "pre-commit")).toBe("#!/bin/sh\necho mine\n");
  });

  it("refuses to install when core.hooksPath is set", () => {
    using repo = createTempRepo();
    repo.git("config", "core.hooksPath", ".husky");

    const { status, stderr } = ward(repo);

    expect(status).toBe(1);
    expect(stderr).toContain("core.hooksPath is set");
    expect(existsSync(join(repo.dir, ".husky"))).toBe(false);
    expect(existsSync(join(repo.dir, ".git", "hooks", "pre-commit"))).toBe(
      false,
    );
  });
});

describe("ward (install no-op)", () => {
  it("skips outside a git repo", () => {
    using dir = createTempRepo({ init: false });
    dir.env.GIT_CEILING_DIRECTORIES = resolve(dir.dir, "..");

    const { status, stdout } = ward(dir);

    expect(status).toBe(0);
    expect(stdout).toContain("not inside a git working tree");
  });

  it("skips inside the git dir", () => {
    using repo = createTempRepo();

    expect(ward(repo, [], join(repo.dir, ".git")).status).toBe(0);
    expect(existsSync(join(repo.dir, ".git", "hooks", "pre-commit"))).toBe(
      false,
    );
  });

  it("skips when git is not installed", () => {
    using repo = createTempRepo();
    // Windows spells it `Path`; drop every casing so git can't be found.
    const env = Object.fromEntries(
      Object.entries(repo.env).filter(([key]) => key.toUpperCase() !== "PATH"),
    );
    env.PATH = join(repo.dir, "no-bin");

    const { status, stdout } = ward({ ...repo, env });

    expect(status).toBe(0);
    expect(stdout).toContain("git not found");
  });

  it.each(["true", "1", "True", "yes"])("skips in CI (CI=%s)", (value) => {
    using repo = createTempRepo();
    repo.env.CI = value;

    const { status, stdout } = ward(repo);

    expect(status).toBe(0);
    expect(stdout).toContain("CI detected");
    expect(existsSync(join(repo.dir, ".git", "hooks", "pre-commit"))).toBe(
      false,
    );
  });

  it.each(["", "0", "false", "FALSE"])("installs when CI=%j", (value) => {
    using repo = createTempRepo();
    repo.env.CI = value;

    expect(ward(repo).status).toBe(0);
    expect(existsSync(join(repo.dir, ".git", "hooks", "pre-commit"))).toBe(
      true,
    );
  });
});

describe("installed hooks", () => {
  it("run ward and let git commit", () => {
    using repo = createTempRepo();
    // What npm puts in node_modules/.bin, pointing at the source CLI.
    repo.write(
      "node_modules/.bin/ward",
      `#!/bin/sh\nexec "${process.execPath.replaceAll("\\", "/")}" "${CLI.replaceAll("\\", "/")}" "$@"\n`,
    );
    chmodSync(join(repo.dir, "node_modules/.bin/ward"), 0o755);
    expect(ward(repo).status).toBe(0);

    const commit = spawnSync("git", ["commit", "--allow-empty", "-m", "msg"], {
      cwd: repo.dir,
      env: repo.env,
      encoding: "utf8",
    });

    expect(commit.stderr).not.toContain("not found");
    expect(commit.status).toBe(0);
  });
});

describe("ward (cli)", () => {
  it("rejects unknown commands", () => {
    using repo = createTempRepo();
    const { status, stderr } = ward(repo, ["nope"]);

    expect(status).toBe(1);
    expect(stderr).toContain('unknown command "nope"');
  });

  it("rejects unknown options without a stack trace", () => {
    using repo = createTempRepo();
    const { status, stderr } = ward(repo, ["--nope"]);

    expect(status).toBe(1);
    expect(stderr).toMatch(/^ward: .*--nope/);
    expect(stderr).not.toContain("    at ");
  });
});
