import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

function ward(repo: TempRepo, args: string[], cwd = repo.dir) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [CLI, ...args],
    { cwd, env: repo.env, encoding: "utf8" },
  );
  return { status, stdout, stderr };
}

describe("ward run", () => {
  it("exits 0 without output when there is no config", () => {
    using repo = createTempRepo();

    expect(ward(repo, ["run", "pre-commit"])).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("exits 0 without output when the hook is not configured", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  pre-push: npm test\n");

    expect(ward(repo, ["run", "pre-commit"])).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("exits 0 for a hook with no tasks", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  pre-commit: []\n");

    expect(ward(repo, ["run", "pre-commit"]).stderr).toBe("");
  });

  it("finds the config from a subdirectory", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  pre-commit: npm test\n");
    mkdirSync(join(repo.dir, "src"));

    const { status, stderr } = ward(
      repo,
      ["run", "pre-commit"],
      join(repo.dir, "src"),
    );

    expect(status).toBe(0);
    expect(stderr).toContain("pre-commit has 1 tasks");
  });

  it("reads a TS config", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.config.ts",
      'const hooks: Record<string, string> = { "pre-commit": "npm test" };\nexport default { hooks };\n',
    );

    expect(ward(repo, ["run", "pre-commit"]).stderr).toContain(
      "pre-commit has 1 tasks",
    );
  });

  it("reads the package.json section", () => {
    using repo = createTempRepo();
    repo.write(
      "package.json",
      JSON.stringify({ ward: { hooks: { "pre-commit": ["a", "b"] } } }),
    );

    expect(ward(repo, ["run", "pre-commit"]).stderr).toContain(
      "pre-commit has 2 tasks",
    );
  });

  it("fails on an invalid config, even for another hook", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  pre-comit: npm test\n");

    const { status, stderr } = ward(repo, ["run", "pre-push"]);

    expect(status).toBe(1);
    expect(stderr).toBe(
      "ward: ward.yml is invalid:\n" +
        '  hooks.pre-comit: unknown hook. Did you mean "pre-commit"?\n',
    );
  });

  it('names the package.json section as `package.json "ward"`', () => {
    using repo = createTempRepo();
    repo.write("package.json", JSON.stringify({ ward: { hooks: 1 } }));

    expect(ward(repo, ["run", "pre-commit"]).stderr).toContain(
      'ward: package.json "ward" is invalid:',
    );
  });

  it("fails when the config can't be loaded", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks: [\n");

    const { status, stderr } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(1);
    expect(stderr).toMatch(/^ward: ward\.yml: /);
  });

  it("fails without a hook name", () => {
    using repo = createTempRepo();

    const { status, stderr } = ward(repo, ["run"]);

    expect(status).toBe(1);
    expect(stderr).toContain("missing hook name");
  });

  it("fails on an unknown hook", () => {
    using repo = createTempRepo();

    const { status, stderr } = ward(repo, ["run", "pre-comit"]);

    expect(status).toBe(1);
    expect(stderr).toContain('unknown hook "pre-comit"');
  });

  it("fails outside a git working tree", () => {
    using dir = createTempRepo({ init: false });

    const { status, stderr } = ward(dir, ["run", "pre-commit"]);

    expect(status).toBe(1);
    expect(stderr).toContain("not inside a git working tree");
  });
});

// Through the stubs: git runs the hook, the hook runs `ward run`.
const posixOnly = process.platform === "win32" ? it.skip : it;

/** Install the stubs, with `node_modules/.bin/ward` pointing at the source CLI. */
function installStubs(repo: TempRepo) {
  const bin = join(repo.dir, "node_modules/.bin/ward");
  repo.write(
    "node_modules/.bin/ward",
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"\n`,
  );
  chmodSync(bin, 0o755);
  expect(ward(repo, []).status).toBe(0);
}

function commit(repo: TempRepo) {
  repo.git("add", "ward.yml");
  return spawnSync("git", ["commit", "-m", "init"], {
    cwd: repo.dir,
    env: repo.env,
    encoding: "utf8",
  });
}

describe("ward run from git", () => {
  posixOnly("lets the commit through when the hook is not configured", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  pre-push: npm test\n");
    installStubs(repo);

    expect(commit(repo).status).toBe(0);
    expect(repo.git("log", "--format=%s")).toBe("init");
  });

  posixOnly("blocks the commit on an invalid config", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  pre-comit: npm test\n");
    installStubs(repo);

    const result = commit(repo);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ward.yml is invalid");
  });
});
