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
    expect(stderr).toContain(
      "hooks not installed by ward found in .git/hooks: pre-commit",
    );
    expect(stderr).toContain("npx ward --chain");
    expect(stderr).toContain("npx ward --force");
    expect(hook(repo, "pre-commit")).toBe("#!/bin/sh\necho mine\n");
  });

  it("chains foreign hooks with --chain", () => {
    using repo = createTempRepo();
    repo.write(".git/hooks/pre-commit", "#!/bin/sh\necho mine\n");

    const { status, stdout } = ward(repo, ["--chain"]);

    expect(status).toBe(0);
    expect(stdout).toContain("kept existing pre-commit as pre-commit.pre-ward");
    expect(hook(repo, "pre-commit.pre-ward")).toBe("#!/bin/sh\necho mine\n");
    expect(hook(repo, "pre-commit")).toContain("# ward:managed");
  });

  it("replaces foreign hooks with --force", () => {
    using repo = createTempRepo();
    repo.write(".git/hooks/pre-commit", "#!/bin/sh\necho mine\n");

    const { status, stderr } = ward(repo, ["--force"]);

    expect(status).toBe(0);
    expect(stderr).toContain(
      "replaced hooks not installed by ward: pre-commit",
    );
    expect(hook(repo, "pre-commit")).toContain("# ward:managed");
    expect(existsSync(join(repo.dir, ".git/hooks/pre-commit.pre-ward"))).toBe(
      false,
    );
  });

  it("suggests --chain --force when the backup is taken", () => {
    using repo = createTempRepo();
    repo.write(".git/hooks/pre-commit", "new\n");
    repo.write(".git/hooks/pre-commit.pre-ward", "old\n");

    const { stderr } = ward(repo, ["--chain"]);

    expect(stderr).toContain("pre-commit.pre-ward already exists");
    expect(stderr).toContain("npx ward --chain --force");
  });

  it("refuses to install when core.hooksPath is set", () => {
    using repo = createTempRepo();
    repo.git("config", "core.hooksPath", ".husky");

    const { status, stderr } = ward(repo);

    expect(status).toBe(1);
    expect(stderr).toContain(
      'core.hooksPath is set to ".husky" (local config): git runs hooks from .husky and ignores .git/hooks.',
    );
    expect(stderr).toContain("git config --unset core.hooksPath");
    expect(stderr).toContain("npx ward --respect-hooks-path");
    expect(existsSync(join(repo.dir, ".husky"))).toBe(false);
    expect(existsSync(join(repo.dir, ".git", "hooks", "pre-commit"))).toBe(
      false,
    );
  });

  it("suggests the unset command for the config scope", () => {
    using repo = createTempRepo();
    repo.git("config", "--global", "core.hooksPath", ".githooks");

    const { status, stderr } = ward(repo);

    expect(status).toBe(1);
    expect(stderr).toContain("(global config)");
    expect(stderr).toContain("git config --global --unset core.hooksPath");
  });

  it("explains a core.hooksPath set via git -c", () => {
    using repo = createTempRepo();
    repo.env.GIT_CONFIG_COUNT = "1";
    repo.env.GIT_CONFIG_KEY_0 = "core.hooksPath";
    repo.env.GIT_CONFIG_VALUE_0 = ".githooks";

    const { status, stderr } = ward(repo);

    expect(status).toBe(1);
    expect(stderr).toContain("(command config)");
    expect(stderr).toContain(
      "remove core.hooksPath from git -c / GIT_CONFIG_*",
    );
    expect(stderr).not.toContain("--unset");
  });

  it("installs into core.hooksPath with --respect-hooks-path", () => {
    using repo = createTempRepo();
    repo.git("config", "core.hooksPath", ".githooks");

    const { status, stdout } = ward(repo, ["--respect-hooks-path"]);

    expect(status).toBe(0);
    expect(stdout).toContain(
      `${String(HOOKS.length)} hooks installed in .githooks`,
    );
    expect(
      readFileSync(join(repo.dir, ".githooks", "pre-commit"), "utf8"),
    ).toContain("bin='node_modules/.bin/ward'");
    expect(existsSync(join(repo.dir, ".git", "hooks", "pre-commit"))).toBe(
      false,
    );
  });

  it("keeps --respect-hooks-path in the --chain hint", () => {
    using repo = createTempRepo();
    repo.git("config", "core.hooksPath", ".githooks");
    repo.write(".githooks/pre-commit", "#!/bin/sh\necho mine\n");

    const { status, stderr } = ward(repo, ["--respect-hooks-path"]);

    expect(status).toBe(0);
    expect(stderr).toContain("found in .githooks: pre-commit");
    expect(stderr).toContain("npx ward --respect-hooks-path --chain");
  });

  it("chains foreign hooks in core.hooksPath", () => {
    using repo = createTempRepo();
    repo.git("config", "core.hooksPath", ".githooks");
    repo.write(".githooks/pre-commit", "#!/bin/sh\necho mine\n");

    expect(ward(repo, ["--respect-hooks-path", "--chain"]).status).toBe(0);

    expect(
      readFileSync(join(repo.dir, ".githooks", "pre-commit.pre-ward"), "utf8"),
    ).toBe("#!/bin/sh\necho mine\n");
  });

  it.each([
    ["outside the repo", "outside"],
    ["the repo root", "."],
  ])(
    "refuses core.hooksPath at %s even with --respect-hooks-path",
    (_, path) => {
      using repo = createTempRepo();
      const dir =
        path === "outside" ? join(repo.dir, "..", "ward-shared-hooks") : path;
      repo.git("config", "core.hooksPath", dir);

      const { status, stderr } = ward(repo, ["--respect-hooks-path"]);

      expect(status).toBe(1);
      expect(stderr).toContain("not installing into");
      expect(stderr).toContain("git config --unset core.hooksPath");
      expect(stderr).not.toContain("npx ward --respect-hooks-path");
      expect(existsSync(join(repo.dir, "pre-commit"))).toBe(false);
      expect(existsSync(join(repo.dir, "..", "ward-shared-hooks"))).toBe(false);
    },
  );

  it("allows core.hooksPath inside the git dir", () => {
    using repo = createTempRepo();
    repo.git("config", "core.hooksPath", ".git/custom-hooks");

    expect(ward(repo, ["--respect-hooks-path"]).status).toBe(0);
    expect(
      existsSync(join(repo.dir, ".git", "custom-hooks", "pre-commit")),
    ).toBe(true);
  });

  it("installs into .git/hooks with --respect-hooks-path and no core.hooksPath", () => {
    using repo = createTempRepo();

    expect(ward(repo, ["--respect-hooks-path"]).status).toBe(0);
    expect(existsSync(join(repo.dir, ".git", "hooks", "pre-commit"))).toBe(
      true,
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
  it("run from core.hooksPath", () => {
    using repo = createTempRepo();
    repo.git("config", "core.hooksPath", ".githooks");
    // A bin that leaves a trace, to prove git ran the stub from .githooks.
    repo.write(
      "node_modules/.bin/ward",
      '#!/bin/sh\necho "$@" >> ward-ran.txt\n',
    );
    chmodSync(join(repo.dir, "node_modules/.bin/ward"), 0o755);
    expect(ward(repo, ["--respect-hooks-path"]).status).toBe(0);

    const commit = spawnSync("git", ["commit", "--allow-empty", "-m", "msg"], {
      cwd: repo.dir,
      env: repo.env,
      encoding: "utf8",
    });

    expect(commit.status).toBe(0);
    expect(readFileSync(join(repo.dir, "ward-ran.txt"), "utf8")).toContain(
      "run pre-commit",
    );
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
