import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, realpathSync } from "node:fs";
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

/** A command that runs a JS snippet (no double quotes) on any platform's shell. */
function node(script: string): string {
  return `"${process.execPath}" -e "${script}"`;
}

/** Write a `pre-commit` hook to the `package.json` section. */
function writeHook(repo: TempRepo, hook: unknown) {
  repo.write(
    "package.json",
    JSON.stringify({ ward: { hooks: { "pre-commit": hook } } }),
  );
}

const posixOnly = process.platform === "win32" ? it.skip : it;

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

  it("runs tasks from the repo root, also from a subdirectory", () => {
    using repo = createTempRepo();
    writeHook(repo, [node("console.log(process.cwd())")]);
    mkdirSync(join(repo.dir, "src"));

    const { status, stdout } = ward(
      repo,
      ["run", "pre-commit"],
      join(repo.dir, "src"),
    );

    expect(status).toBe(0);
    expect(realpathSync.native(stdout.trim())).toBe(repo.dir);
  });

  it("reads a TS config", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.config.ts",
      `const hooks: Record<string, string> = { "pre-commit": ${JSON.stringify(node("console.log('ts')"))} };\nexport default { hooks };\n`,
    );

    expect(ward(repo, ["run", "pre-commit"]).stdout).toBe("ts\n");
  });

  it("reads a YAML config", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.yml",
      `hooks:\n  pre-commit: ${JSON.stringify(node("console.log('yml')"))}\n`,
    );

    expect(ward(repo, ["run", "pre-commit"]).stdout).toBe("yml\n");
  });

  it("runs tasks in order", () => {
    using repo = createTempRepo();
    writeHook(repo, [
      node("console.log('a')"),
      node("console.log('b')"),
      node("console.log('c')"),
    ]);

    expect(ward(repo, ["run", "pre-commit"])).toEqual({
      status: 0,
      stdout: "a\nb\nc\n",
      stderr: "",
    });
  });

  it("runs named tasks in config order", () => {
    using repo = createTempRepo();
    writeHook(repo, {
      tasks: {
        second: { run: node("console.log('a')") },
        first: { run: node("console.log('b')") },
      },
    });

    expect(ward(repo, ["run", "pre-commit"]).stdout).toBe("a\nb\n");
  });

  it("stops on the first failure and exits with its code", () => {
    using repo = createTempRepo();
    writeHook(repo, {
      tasks: {
        ok: { run: node("console.log('a')") },
        lint: { run: node("process.exit(3)") },
        never: { run: node("console.log('c')") },
      },
    });

    expect(ward(repo, ["run", "pre-commit"])).toEqual({
      status: 3,
      stdout: "a\n",
      stderr: "ward: pre-commit failed: lint (exit 3)\n",
    });
  });

  it("passes the task's stderr through", () => {
    using repo = createTempRepo();
    writeHook(repo, [node("console.error('oops'); process.exit(1)")]);

    const { status, stderr } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(1);
    expect(stderr).toMatch(/^oops\nward: pre-commit failed: /);
  });

  it("fails when the command is not found", () => {
    using repo = createTempRepo();
    writeHook(repo, ["ward-no-such-command", node("console.log('b')")]);

    const { status, stdout } = ward(repo, ["run", "pre-commit"]);

    expect(status).not.toBe(0);
    expect(stdout).toBe("");
  });

  it("runs commands through the shell", () => {
    using repo = createTempRepo();
    writeHook(repo, [
      `${node("console.log('a')")} && ${node("process.exit(2)")}`,
    ]);

    const { status, stdout } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(2);
    expect(stdout).toBe("a\n");
  });

  it("passes stdin to the task", () => {
    using repo = createTempRepo();
    writeHook(repo, [node("process.stdin.pipe(process.stdout)")]);

    const { stdout } = spawnSync(process.execPath, [CLI, "run", "pre-commit"], {
      cwd: repo.dir,
      env: repo.env,
      encoding: "utf8",
      input: "refs\n",
    });

    expect(stdout).toBe("refs\n");
  });

  posixOnly("exits with 128 + signal when a task is killed", () => {
    using repo = createTempRepo();
    writeHook(repo, ["kill -TERM $$"]);

    const { status, stderr } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(143);
    expect(stderr).toContain("(exit 143)");
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
  posixOnly("blocks the commit when a task fails", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", 'hooks:\n  pre-commit: ["true", exit 4]\n');
    installStubs(repo);

    const result = commit(repo);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ward: pre-commit failed: exit 4 (exit 4)");
    expect(repo.git("rev-list", "--all", "--count")).toBe("0");
  });

  posixOnly("lets the commit through when all tasks pass", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", 'hooks:\n  pre-commit: ["true", echo ok]\n');
    installStubs(repo);

    expect(commit(repo).status).toBe(0);
    expect(repo.git("log", "--format=%s")).toBe("init");
  });

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
