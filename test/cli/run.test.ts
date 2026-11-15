import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

function ward(repo: TempRepo, args: string[], cwd = repo.dir, env = repo.env) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [CLI, ...args],
    { cwd, env, encoding: "utf8" },
  );
  return { status, stdout, stderr };
}

/** A command that runs a JS snippet (no double quotes) on any platform's shell. */
function node(script: string): string {
  return `"${process.execPath}" -e "${script}"`;
}

/** Prints the arguments it gets, joined by `|`. */
const PRINT_ARGS = "console.log(process.argv.slice(1).join('|'))";

/** Write a `pre-commit` hook to the `package.json` section. */
function writeHook(repo: TempRepo, hook: unknown) {
  repo.write(
    "package.json",
    JSON.stringify({ ward: { hooks: { "pre-commit": hook } } }),
  );
}

/** Two branches that change the same line: `main` and `other`. */
function conflictingBranches(repo: TempRepo) {
  repo.commit("base", { "a.txt": "base\n" });
  repo.git("switch", "--quiet", "-c", "other");
  repo.commit("other", { "a.txt": "other\n" });
  repo.git("switch", "--quiet", "main");
  repo.commit("main", { "a.txt": "main\n" });
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

  it("expands {1}, {2} to the hook arguments", () => {
    using repo = createTempRepo();
    writeHook(repo, [
      `${node("console.log(JSON.stringify(process.argv.slice(1)))")} {2} {1} {3}`,
    ]);

    const { status, stdout } = ward(repo, [
      "run",
      "pre-commit",
      "msg file",
      "second",
    ]);

    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual(["second", "msg file"]);
  });

  it("skips the hook with WARD=0", () => {
    using repo = createTempRepo();
    writeHook(repo, [node("process.exit(3)")]);

    expect(
      ward(repo, ["run", "pre-commit"], repo.dir, { ...repo.env, WARD: "0" }),
    ).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("skips with WARD=0 even when the config is invalid", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  pre-comit: npm test\n");

    expect(
      ward(repo, ["run", "pre-commit"], repo.dir, { ...repo.env, WARD: "0" })
        .status,
    ).toBe(0);
  });

  it("runs the hook for other values of WARD", () => {
    using repo = createTempRepo();
    writeHook(repo, [node("process.exit(3)")]);

    expect(
      ward(repo, ["run", "pre-commit"], repo.dir, { ...repo.env, WARD: "1" })
        .status,
    ).toBe(3);
  });

  it("skips the hook while a merge is in progress", () => {
    using repo = createTempRepo();
    conflictingBranches(repo);
    writeHook(repo, [node("process.exit(3)")]);
    expect(ward(repo, ["run", "pre-commit"]).status).toBe(3);

    spawnSync("git", ["merge", "other"], { cwd: repo.dir, env: repo.env });

    expect(ward(repo, ["run", "pre-commit"])).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("skips the hook while a rebase is in progress", () => {
    using repo = createTempRepo();
    conflictingBranches(repo);
    writeHook(repo, [node("process.exit(3)")]);

    spawnSync("git", ["rebase", "other"], { cwd: repo.dir, env: repo.env });

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);

    repo.git("rebase", "--abort");
    expect(ward(repo, ["run", "pre-commit"]).status).toBe(3);
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

  it("passes staged files that match the task's glob", () => {
    using repo = createTempRepo();
    repo.commit("init", { "old.ts": "o\n" });
    writeHook(repo, {
      tasks: {
        ts: {
          run: `${node(PRINT_ARGS)} {staged_files}`,
          glob: "*.ts",
          exclude: "*.test.ts",
        },
        md: { run: `${node(PRINT_ARGS)} {staged_files}`, glob: "*.md" },
      },
    });
    repo.write("src/a.ts", "a\n");
    repo.write("src/a.test.ts", "t\n");
    repo.write("my notes.md", "n\n");
    repo.write("unstaged.ts", "u\n");
    repo.git("add", "src", "my notes.md");

    expect(ward(repo, ["run", "pre-commit"])).toEqual({
      status: 0,
      stdout: "src/a.ts\nmy notes.md\n",
      stderr: "",
    });
  });

  it("skips a task when no files match", () => {
    using repo = createTempRepo();
    repo.commit("init");
    writeHook(repo, {
      tasks: {
        ts: { run: `${node(PRINT_ARGS)} ts {staged_files}`, glob: "*.ts" },
        all: { run: `${node(PRINT_ARGS)} all {staged_files}` },
        never: { run: node("process.exit(1)"), glob: "*.ts" },
        always: { run: node("console.log('always')") },
      },
    });
    repo.write("a.md", "a\n");
    repo.git("add", "a.md");

    expect(ward(repo, ["run", "pre-commit"])).toEqual({
      status: 0,
      stdout: "all|a.md\nalways\n",
      stderr: "",
    });
  });

  it("skips a task when nothing is staged", () => {
    using repo = createTempRepo();
    repo.commit("init");
    writeHook(repo, [node("process.exit(1)") + " {staged_files}"]);
    repo.git("add", "package.json");
    repo.git("commit", "--quiet", "--no-verify", "-m", "config");

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);
  });

  it("runs a task with glob and no placeholder when a staged file matches", () => {
    using repo = createTempRepo();
    repo.commit("init");
    writeHook(repo, {
      tasks: { tsc: { run: node("console.log('tsc')"), glob: "*.ts" } },
    });
    repo.write("src/a.ts", "a\n");
    repo.git("add", "src/a.ts");

    expect(ward(repo, ["run", "pre-commit"]).stdout).toBe("tsc\n");
  });

  posixOnly("leaves out symlinks unless the task sets `symlinks: true`", () => {
    using repo = createTempRepo();
    repo.commit("init", { "target.md": "t\n" });
    writeHook(repo, {
      tasks: {
        plain: {
          run: `${node(PRINT_ARGS)} plain {staged_files}`,
          glob: "*.md",
        },
        links: {
          run: `${node(PRINT_ARGS)} links {staged_files}`,
          glob: "*.md",
          symlinks: true,
        },
      },
    });
    symlinkSync("target.md", join(repo.dir, "link.md"));
    repo.write("a.md", "a\n");
    repo.git("add", "link.md", "a.md");

    expect(ward(repo, ["run", "pre-commit"]).stdout).toBe(
      "plain|a.md\nlinks|a.md|link.md\n",
    );
  });

  it("runs a task several times for a file list over the length limit", () => {
    using repo = createTempRepo();
    repo.commit("init");
    // ~150 KB of paths: over the limit on every platform.
    const names = Array.from(
      { length: 1000 },
      (_, i) => `src/${"x".repeat(140)}-${String(i).padStart(4, "0")}.ts`,
    );
    for (const name of names) repo.write(name, "");
    writeHook(repo, [
      `${node("require('fs').appendFileSync('runs.txt', process.argv.slice(1).join('\\n') + '\\n--\\n')")} {staged_files}`,
    ]);
    repo.git("add", "src");

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);

    const runs = readFileSync(join(repo.dir, "runs.txt"), "utf8")
      .split("--\n")
      .filter((run) => run !== "")
      .map((run) => run.trimEnd().split("\n"));
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.flat()).toEqual(names);
  });

  it("passes all tracked files with {all_files}", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n", "b.md": "b\n" });
    writeHook(repo, [`${node(PRINT_ARGS)} {all_files}`]);
    repo.git("add", "package.json");

    expect(ward(repo, ["run", "pre-commit"]).stdout).toBe(
      "a.ts|b.md|package.json\n",
    );
  });

  it("passes pushed files and keeps stdin for the tasks", () => {
    using repo = createTempRepo();
    const origin = join(repo.dir, ".git", "origin.git");
    repo.git("init", "--quiet", "--bare", origin);
    repo.git("remote", "add", "origin", origin);
    repo.commit("init", { "old.ts": "o\n" });
    repo.git("push", "--quiet", "--no-verify", "origin", "main");
    repo.write(
      "ward.yml",
      "hooks:\n" +
        "  pre-push:\n" +
        `    - ${JSON.stringify(`${node(PRINT_ARGS)} {push_files}`)}\n` +
        `    - ${JSON.stringify(node("process.stdin.pipe(process.stdout)"))}\n`,
    );
    repo.commit("next", { "new.ts": "n\n" });

    const sha = repo.git("rev-parse", "main");
    const remoteSha = repo.git("rev-parse", "origin/main");
    const input = `refs/heads/main ${sha} refs/heads/main ${remoteSha}\n`;
    const { status, stdout } = spawnSync(
      process.execPath,
      [CLI, "run", "pre-push", "origin", origin],
      { cwd: repo.dir, env: repo.env, encoding: "utf8", input },
    );

    expect(status).toBe(0);
    expect(stdout).toBe(`new.ts|ward.yml\n${input}`);
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
  posixOnly("lets a merge commit through without running tasks", () => {
    using repo = createTempRepo();
    conflictingBranches(repo);
    repo.write("ward.yml", "hooks:\n  pre-commit: exit 4\n");
    installStubs(repo);
    spawnSync("git", ["merge", "other"], { cwd: repo.dir, env: repo.env });
    repo.write("a.txt", "merged\n");
    repo.git("add", "a.txt");

    const result = spawnSync("git", ["commit", "--no-edit"], {
      cwd: repo.dir,
      env: repo.env,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(repo.git("rev-list", "--count", "--merges", "HEAD")).toBe("1");
  });

  posixOnly("passes the commit message file as {1}", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  commit-msg: grep -q init {1}\n");
    installStubs(repo);

    expect(commit(repo).status).toBe(0);

    repo.write("ward.yml", "hooks:\n  commit-msg: grep -q other {1}\n");
    const result = commit(repo);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ward: commit-msg failed");
  });

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
