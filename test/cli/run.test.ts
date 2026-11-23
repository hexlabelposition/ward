import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { parseRunArgs } from "../../src/cli/run.ts";
import { HOOKS } from "../../src/hooks/list.ts";
import { renderStub, STUB_VERSION } from "../../src/hooks/stub.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";
import { CLI, evalCommand, writeWardBin } from "../helpers/ward-bin.ts";

function ward(
  repo: TempRepo,
  args: string[],
  cwd = repo.dir,
  env = repo.env,
  input?: string,
) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [CLI, ...args],
    { cwd, env, encoding: "utf8", input },
  );
  return { status, stdout, stderr };
}

/** A command that runs a JS snippet (no double quotes) on any platform's shell. */
function node(script: string): string {
  return evalCommand(script);
}

/** Prints the arguments it gets, joined by `|`. */
const PRINT_ARGS = "console.log(process.argv.slice(1).join('|'))";

/** Upper-cases the files it gets, then exits with `process.exitCode`. */
function format(exitCode = 0): string {
  return node(
    "const fs = require('fs'); for (const f of process.argv.slice(1)) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').toUpperCase()); process.exitCode = " +
      String(exitCode),
  );
}

/**
 * Creates `<name>.started`, then waits up to 10 s for `<other>.started`:
 * passes only when the two run at the same time.
 */
function meet(name: string, other: string): string {
  return node(
    `const fs = require('fs'); fs.writeFileSync('${name}.started', ''); const end = Date.now() + 10000; const wait = () => fs.existsSync('${other}.started') ? console.log('${name}') : Date.now() > end ? process.exit(1) : setTimeout(wait, 20); wait()`,
  );
}

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

const MARKER_CURRENT = `# ward:managed v${String(STUB_VERSION)}`;

/** Prints the stash list, to see a backup while the tasks run. */
const LIST_STASH_ENTRIES = "git stash list --format=%gs";

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

  it("runs a hook named in camelCase", () => {
    using repo = createTempRepo();
    repo.write(
      "package.json",
      JSON.stringify({
        ward: { hooks: { preCommit: node("console.log('ran')") } },
      }),
    );

    const { status, stdout } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(0);
    expect(stdout).toBe("ran\n");
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

  it("stages the files a task fixed, not other changes", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "", "b.ts": "B\n", "c.ts": "", "d.ts": "" });
    writeHook(repo, {
      tasks: { format: { run: `${format()} {staged_files}`, glob: "*.ts" } },
    });
    repo.git("add", "package.json");
    repo.write("a.ts", "a\n");
    repo.write("b.ts", "B2\n");
    repo.git("add", "a.ts", "b.ts");
    // Not staged: the task does not get it.
    repo.write("c.ts", "c\n");

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);
    expect(repo.git("show", ":a.ts")).toBe("A");
    expect(repo.git("diff", "--cached", "--name-only")).toBe(
      "a.ts\nb.ts\npackage.json",
    );
    expect(repo.git("diff", "--name-only")).toBe("c.ts");
  });

  it("stages fixes of files from {all_files} only when they are staged", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n", "b.ts": "b\n" });
    writeHook(repo, [`${format()} {all_files}`]);
    repo.write("a.ts", "a2\n");
    repo.git("add", "package.json", "a.ts");

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);
    expect(repo.git("diff", "--name-only")).toBe("a.ts\nb.ts\npackage.json");
    expect(repo.git("show", ":a.ts")).toBe("a2");
  });

  it("leaves fixes unstaged with `stageFixed: false`", () => {
    using repo = createTempRepo();
    repo.commit("init");
    writeHook(repo, {
      tasks: {
        format: { run: `${format()} {staged_files}`, stageFixed: false },
      },
    });
    repo.write("a.ts", "a\n");
    repo.git("add", "package.json", "a.ts");

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);
    expect(repo.git("show", ":a.ts")).toBe("a");
    expect(repo.git("diff", "--name-only")).toBe("a.ts\npackage.json");
  });

  it("leaves the changes of a failed task unstaged with --no-revert", () => {
    using repo = createTempRepo();
    repo.commit("init");
    writeHook(repo, {
      tasks: { format: { run: `${format(2)} {staged_files}`, glob: "*.ts" } },
    });
    repo.write("a.ts", "a\n");
    repo.git("add", "package.json", "a.ts");

    expect(ward(repo, ["run", "pre-commit", "--no-revert"]).status).toBe(2);
    expect(repo.git("show", ":a.ts")).toBe("a");
    expect(repo.git("diff", "--name-only")).toBe("a.ts");
  });

  it("calls a function task with the matching files and hook args", () => {
    using repo = createTempRepo();
    repo.commit("init");
    repo.write(
      "ward.config.ts",
      `export default { hooks: {
  "pre-commit": { tasks: { check: {
    run: (ctx: { files: string[]; args: string[] }) => {
      console.log(JSON.stringify(ctx));
      console.log(process.cwd());
    },
    glob: "src/**/*.ts",
  } } },
  "commit-msg": { tasks: { msg: { run: async (ctx: unknown) => {
    await Promise.resolve();
    console.log(JSON.stringify(ctx));
  } } } },
} };\n`,
    );
    repo.write("src/a b.ts", "");
    repo.write("b.md", "");
    repo.git("add", ".");

    const { status, stdout } = ward(
      repo,
      ["run", "pre-commit"],
      join(repo.dir, "src"),
    );
    expect(status).toBe(0);
    const [ctx = "", cwd = ""] = stdout.trim().split("\n");
    expect(JSON.parse(ctx)).toEqual({ files: ["src/a b.ts"], args: [] });
    expect(realpathSync.native(cwd)).toBe(repo.dir);

    expect(ward(repo, ["run", "commit-msg", "MSG"]).stdout).toBe(
      '{"files":[],"args":["MSG"]}\n',
    );
  });

  it("skips a function task with `glob` when no file matches", () => {
    using repo = createTempRepo();
    repo.commit("init");
    repo.write(
      "ward.config.ts",
      `export default { hooks: { "pre-commit": { tasks: {
  js: { run: () => console.log("js"), glob: "*.js" },
  any: { run: () => console.log("any") },
} } } };\n`,
    );
    repo.git("add", ".");

    expect(ward(repo, ["run", "pre-commit"]).stdout).toBe("any\n");
  });

  it("fails when a function task throws or rejects", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.config.ts",
      `export default { hooks: {
  "pre-commit": { tasks: {
    check: { run: () => { throw new Error("2 files have no license"); } },
    next: { run: () => console.log("next") },
  } },
  "pre-push": { tasks: { check: { run: () => Promise.reject("nope") } } },
} };\n`,
    );

    expect(ward(repo, ["run", "pre-commit"])).toEqual({
      status: 1,
      stdout: "",
      stderr:
        "2 files have no license\nward: pre-commit failed: check (exit 1)\n",
    });
    expect(ward(repo, ["run", "pre-push", "origin", "url"]).stderr).toBe(
      "nope\nward: pre-push failed: check (exit 1)\n",
    );
  });

  it("stages files a function task fixed", () => {
    using repo = createTempRepo();
    repo.commit("init");
    repo.write(
      "ward.config.ts",
      `import { readFileSync, writeFileSync } from "node:fs";
export default { hooks: { "pre-commit": { tasks: { format: {
  run: ({ files }: { files: string[] }) => {
    for (const f of files) writeFileSync(f, readFileSync(f, "utf8").toUpperCase());
  },
  glob: "a.ts",
} } } } };\n`,
    );
    repo.write("a.ts", "a\n");
    repo.git("add", ".");

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);
    expect(repo.git("show", ":a.ts")).toBe("A");
  });

  it("runs tasks at the same time with `parallel: true`", () => {
    using repo = createTempRepo();
    writeHook(repo, {
      parallel: true,
      tasks: { a: { run: meet("a", "b") }, b: { run: meet("b", "a") } },
    });

    const { status, stdout } = ward(repo, ["run", "pre-commit"]);
    expect(status).toBe(0);
    expect(stdout.split("\n").sort()).toEqual(["", "a | a", "b | b"]);
  });

  it("runs every parallel task to the end and exits with the first failure in config order", () => {
    using repo = createTempRepo();
    writeHook(repo, {
      parallel: true,
      tasks: {
        slow: { run: node("setTimeout(() => process.exit(3), 300)") },
        fast: { run: "exit 4" },
        ok: { run: node("setTimeout(() => console.log('ok'), 500)") },
      },
    });

    const { status, stdout, stderr } = ward(repo, ["run", "pre-commit"]);
    expect(status).toBe(3);
    expect(stdout).toBe("ok   | ok\n");
    expect(stderr).toBe(
      "ward: pre-commit failed: fast (exit 4)\n" +
        "ward: pre-commit failed: slow (exit 3)\n",
    );
  });

  it("gives each parallel task a copy of the hook's stdin", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.yml",
      "hooks:\n  post-rewrite:\n    parallel: true\n    tasks:\n" +
        ["a", "b"]
          .map(
            (name) =>
              `      ${name}:\n        run: ${JSON.stringify(node(`let s = ''; process.stdin.on('data', (d) => s += d).on('end', () => console.log('${name}:' + s.trim()))`))}\n`,
          )
          .join(""),
    );

    const { status, stdout } = ward(
      repo,
      ["run", "post-rewrite", "amend"],
      repo.dir,
      repo.env,
      "old new\n",
    );
    expect(status).toBe(0);
    expect(stdout.split("\n").sort()).toEqual([
      "",
      "a | a:old new",
      "b | b:old new",
    ]);
  });

  it("stages files fixed by parallel tasks", () => {
    using repo = createTempRepo();
    repo.commit("init");
    writeHook(repo, {
      parallel: true,
      tasks: {
        ts: { run: `${format()} {staged_files}`, glob: "*.ts" },
        md: { run: `${format()} {staged_files}`, glob: "*.md" },
      },
    });
    repo.write("a.ts", "a\n");
    repo.write("b.md", "b\n");
    repo.git("add", ".");

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);
    expect(repo.git("show", ":a.ts")).toBe("A");
    expect(repo.git("show", ":b.md")).toBe("B");
    expect(repo.git("diff", "--name-only")).toBe("");
  });

  it("prefixes each line of parallel output with the task name", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.config.ts",
      `export default { hooks: { "pre-commit": { parallel: true, tasks: {
  lint: { run: ${JSON.stringify(node("process.stdout.write('one\\ntw'); setTimeout(() => process.stdout.write('o\\nend'), 100)"))} },
  "type check": { run: ${JSON.stringify(node("console.error('bad\\n\\nworse'); process.exit(2)"))} },
  fn: { run: () => { throw new Error("no\\nway"); } },
} } } };\n`,
    );

    const { status, stdout, stderr } = ward(repo, ["run", "pre-commit"]);
    expect(status).toBe(2);
    expect(stdout).toBe(
      "lint       | one\nlint       | two\nlint       | end\n",
    );
    expect(stderr.split("\n").sort()).toEqual([
      "",
      "fn         | no",
      "fn         | way",
      "type check | ",
      "type check | bad",
      "type check | worse",
      "ward: pre-commit failed: fn (exit 1)",
      "ward: pre-commit failed: type check (exit 2)",
    ]);
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

  it("runs the hook as ward.local.yml changes it", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.yml",
      JSON.stringify({
        hooks: {
          "pre-push": {
            tasks: {
              main: { run: node("console.log('main')") },
              slow: { run: node("console.log('slow')") },
            },
          },
        },
      }),
    );
    repo.write(
      "ward.local.yml",
      JSON.stringify({
        hooks: {
          prePush: {
            tasks: { slow: null, mine: { run: node("console.log('mine')") } },
          },
        },
      }),
    );

    const { status, stdout } = ward(repo, ["run", "pre-push"]);

    expect(status).toBe(0);
    expect(stdout).toBe("main\nmine\n");
  });

  it("updates stubs written by another Ward version", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    const stale = renderStub("pre-commit", { bin: "dist/cli.mjs" }).replace(
      MARKER_CURRENT,
      "# ward:managed v1",
    );
    writeFileSync(join(hooksDir, "pre-commit"), stale);

    const first = ward(repo, ["run", "pre-commit"]);

    expect(first.status).toBe(0);
    expect(first.stderr).toBe(
      "ward: updated the git hook stubs for this Ward version\n",
    );
    for (const hook of HOOKS) {
      expect(readFileSync(join(hooksDir, hook), "utf8")).toBe(
        renderStub(hook, { bin: "dist/cli.mjs" }),
      );
    }
    expect(ward(repo, ["run", "pre-commit"]).stderr).toBe("");
  });

  it("runs tasks from configs the TS config extends", () => {
    using repo = createTempRepo();
    repo.write(
      "shared/base.yml",
      JSON.stringify({
        hooks: {
          "pre-push": { tasks: { base: { run: node("console.log('base')") } } },
        },
      }),
    );
    repo.write(
      "ward.config.ts",
      `const preset = {
  hooks: { prePush: { tasks: { preset: { run: ${JSON.stringify(node("console.log('preset')"))} } } } },
};
export default { extends: ["./shared/base.yml", preset] };
`,
    );

    const { status, stdout, stderr } = ward(repo, ["run", "pre-push"]);

    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(stdout).toBe("base\npreset\n");
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

describe("ward run backup", () => {
  /** Prints the stash list, to see the backup while the tasks run. */
  const LIST_STASH = LIST_STASH_ENTRIES;

  it("backs up before the tasks and drops the backup when they pass", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n" });
    writeHook(repo, [LIST_STASH]);
    repo.write("a.ts", "a2\n");

    const { status, stdout } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(0);
    expect(stdout).toBe("ward backup\n");
    expect(repo.git("stash", "list")).toBe("");
  });

  it("keeps the backup when a task fails with --no-revert", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n" });
    writeHook(repo, [`${format(1)} {staged_files}`]);
    repo.git("add", "package.json");
    repo.write("a.ts", "a2\n");
    repo.git("add", "a.ts");
    repo.write("a.ts", "a3\n");

    const { status, stderr } = ward(repo, ["run", "pre-commit", "--no-revert"]);

    expect(status).toBe(1);
    const hash = repo.git("stash", "list", "--format=%H");
    expect(repo.git("stash", "list", "--format=%gs")).toBe("ward backup");
    expect(stderr).toContain(
      `ward: the index and working tree before the run are kept as "ward backup" in \`git stash list\` (${hash})`,
    );
    expect(repo.git("show", `${hash}:a.ts`)).toBe("a3");
    expect(repo.git("show", `${hash}^2:a.ts`)).toBe("a2");
  });

  it("skips the backup with `backup: false`", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n" });
    writeHook(repo, { backup: false, tasks: { list: { run: LIST_STASH } } });
    repo.write("a.ts", "a2\n");

    expect(ward(repo, ["run", "pre-commit"])).toMatchObject({
      status: 0,
      stdout: "",
    });
  });

  it("skips the backup with --no-backup and passes the rest to the hook", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n" });
    writeHook(repo, [LIST_STASH, `${node(PRINT_ARGS)} {1}`]);
    repo.write("a.ts", "a2\n");

    expect(ward(repo, ["run", "pre-commit", "--no-backup", "x"])).toMatchObject(
      { status: 0, stdout: "x\n" },
    );
  });

  it("creates no backup without changes or without a commit", () => {
    using repo = createTempRepo();
    writeHook(repo, ["true"]);
    repo.git("add", "package.json");

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);

    repo.commit("init");
    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);
    expect(repo.git("stash", "list")).toBe("");
  });

  it("leaves the user's stash entries alone", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n" });
    repo.write("a.ts", "mine\n");
    repo.git("stash", "push", "--quiet", "-m", "mine");
    writeHook(repo, ["true"]);
    repo.write("a.ts", "a2\n");

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);
    expect(repo.git("stash", "list", "--format=%gs")).toBe("On main: mine");
  });
});

describe("ward run partial staging", () => {
  const LINES = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";

  /** Replaces `bad` with `good` in the files it gets. */
  const FIX_BAD = node(
    "const fs = require('fs'); for (const f of process.argv.slice(1)) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('bad', 'good'))",
  );

  /** Prints the content of the files it gets. */
  const CAT = node(
    "for (const f of process.argv.slice(1)) process.stdout.write(require('fs').readFileSync(f, 'utf8'))",
  );

  /** `a.txt` with `bad` staged on the first line and `J` unstaged on the last. */
  function partiallyStaged(repo: TempRepo, hook: unknown) {
    repo.commit("init", { "a.txt": LINES });
    writeHook(repo, hook);
    repo.git("add", "package.json");
    repo.write("a.txt", LINES.replace("a", "bad"));
    repo.git("add", "a.txt");
    repo.write("a.txt", LINES.replace("a", "bad").replace("j", "J"));
  }

  function read(repo: TempRepo, path: string) {
    return readFileSync(join(repo.dir, path), "utf8");
  }

  it("runs tasks on the staged version and keeps unstaged changes", () => {
    using repo = createTempRepo();
    partiallyStaged(repo, {
      tasks: {
        cat: { run: `${CAT} {staged_files}`, glob: "*.txt" },
        fix: { run: `${FIX_BAD} {staged_files}`, glob: "*.txt" },
      },
    });

    const { status, stdout } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(0);
    expect(stdout).toBe(LINES.replace("a", "bad"));
    expect(repo.git("show", ":a.txt")).toBe(LINES.replace("a", "good").trim());
    expect(read(repo, "a.txt")).toBe(
      LINES.replace("a", "good").replace("j", "J"),
    );
    expect(existsSync(join(repo.dir, ".git/ward/unstaged.patch"))).toBe(false);
  });

  it("puts unstaged changes back when a task fails with --no-revert", () => {
    using repo = createTempRepo();
    partiallyStaged(repo, {
      tasks: {
        cat: { run: `${CAT} {staged_files}`, glob: "*.txt" },
        fail: { run: "exit 3" },
      },
    });

    expect(ward(repo, ["run", "pre-commit", "--no-revert"]).status).toBe(3);
    expect(read(repo, "a.txt")).toBe(
      LINES.replace("a", "bad").replace("j", "J"),
    );
    expect(repo.git("show", ":a.txt")).toBe(LINES.replace("a", "bad").trim());
  });

  it("leaves conflict markers with --no-revert when a fix overlaps unstaged changes", () => {
    using repo = createTempRepo();
    partiallyStaged(repo, [`${format()} {staged_files}`]);

    const { status, stderr } = ward(repo, ["run", "pre-commit", "--no-revert"]);

    expect(status).toBe(1);
    expect(stderr).toContain(
      "ward: unstaged changes conflict with task fixes in a.txt: resolve the conflicts",
    );
    expect(read(repo, "a.txt")).toContain("<<<<<<<");
    expect(repo.git("show", ":a.txt")).toBe(
      LINES.replace("a", "bad").toUpperCase().trim(),
    );
    expect(existsSync(join(repo.dir, ".git/ward/unstaged.patch"))).toBe(true);
  });

  it("reverts a failed run to the state before it", () => {
    using repo = createTempRepo();
    partiallyStaged(repo, {
      tasks: {
        fix: { run: `${FIX_BAD} {staged_files}`, glob: "*.txt" },
        fail: { run: "exit 3" },
      },
    });
    const status = repo.git("status", "--porcelain");

    const result = ward(repo, ["run", "pre-commit"]);

    expect(result.status).toBe(3);
    expect(result.stderr).toContain(
      "ward: reverted the index and working tree to the state before the run",
    );
    expect(repo.git("show", ":a.txt")).toBe(LINES.replace("a", "bad").trim());
    expect(read(repo, "a.txt")).toBe(
      LINES.replace("a", "bad").replace("j", "J"),
    );
    expect(repo.git("status", "--porcelain")).toBe(status);
    expect(repo.git("stash", "list")).toBe("");
    expect(existsSync(join(repo.dir, ".git/ward/unstaged.patch"))).toBe(false);
  });

  it("reverts when unstaged changes conflict with a fix", () => {
    using repo = createTempRepo();
    partiallyStaged(repo, [`${format()} {staged_files}`]);

    const { status, stderr } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(1);
    expect(stderr).toContain(
      "ward: unstaged changes could not be put back on top of task fixes in a.txt",
    );
    expect(stderr).toContain("ward: reverted the index and working tree");
    expect(repo.git("show", ":a.txt")).toBe(LINES.replace("a", "bad").trim());
    expect(read(repo, "a.txt")).toBe(
      LINES.replace("a", "bad").replace("j", "J"),
    );
    expect(existsSync(join(repo.dir, ".git/ward/unstaged.patch"))).toBe(false);
  });

  it("keeps task changes with `revert: false`", () => {
    using repo = createTempRepo();
    partiallyStaged(repo, {
      revert: false,
      tasks: {
        fix: { run: `${FIX_BAD} {staged_files}`, glob: "*.txt" },
        fail: { run: "exit 3" },
      },
    });

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(3);
    expect(repo.git("show", ":a.txt")).toBe(LINES.replace("a", "good").trim());
    expect(read(repo, "a.txt")).toBe(
      LINES.replace("a", "good").replace("j", "J"),
    );
    expect(repo.git("stash", "list", "--format=%gs")).toBe("ward backup");
  });

  it("only restores unstaged changes without a backup", () => {
    using repo = createTempRepo();
    partiallyStaged(repo, {
      backup: false,
      tasks: {
        fix: { run: `${FIX_BAD} {staged_files}`, glob: "*.txt" },
        fail: { run: "exit 3" },
      },
    });

    const { status, stderr } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(3);
    expect(stderr).not.toContain("reverted");
    expect(repo.git("show", ":a.txt")).toBe(LINES.replace("a", "good").trim());
    expect(read(repo, "a.txt")).toBe(
      LINES.replace("a", "good").replace("j", "J"),
    );
  });

  it("runs tasks on a staged file deleted in the working tree", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n" });
    writeHook(repo, {
      tasks: { format: { run: `${format()} {staged_files}`, glob: "*.txt" } },
    });
    repo.git("add", "package.json");
    repo.write("a.txt", "a2\n");
    repo.git("add", "a.txt");
    rmSync(join(repo.dir, "a.txt"));

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);
    expect(repo.git("show", ":a.txt")).toBe("A2");
    expect(existsSync(join(repo.dir, "a.txt"))).toBe(false);
  });

  it("runs without a backup while the index has conflicts", () => {
    using repo = createTempRepo();
    conflictingBranches(repo);
    writeHook(repo, [LIST_STASH_ENTRIES, node("console.log('ran')")]);
    repo.git("add", "package.json");
    repo.git("commit", "--quiet", "--no-verify", "-m", "config");
    spawnSync("git", ["cherry-pick", "other"], {
      cwd: repo.dir,
      env: repo.env,
    });
    repo.write("b.txt", "b\n");

    const { status, stdout } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(0);
    expect(stdout).toBe("ran\n");
    expect(existsSync(join(repo.dir, ".git/CHERRY_PICK_HEAD"))).toBe(true);
  });

  it("does not hide changes from tasks that get no staged files", () => {
    using repo = createTempRepo();
    partiallyStaged(repo, [`${CAT} a.txt`]);

    const { status, stdout } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(0);
    expect(stdout).toBe(LINES.replace("a", "bad").replace("j", "J"));
  });

  it("hides changes from function tasks too", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.config.ts",
      `import { readFileSync } from "node:fs";\nexport default { hooks: { "pre-commit": { tasks: { cat: { glob: "*.txt", run: ({ files }) => { for (const f of files) process.stdout.write(readFileSync(f, "utf8")); } } } } } };\n`,
    );
    repo.commit("init", { "a.txt": LINES });
    repo.write("a.txt", LINES.replace("a", "bad"));
    repo.git("add", "a.txt");
    repo.write("a.txt", LINES.replace("a", "bad").replace("j", "J"));

    const { status, stdout } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(0);
    expect(stdout).toBe(LINES.replace("a", "bad"));
    expect(read(repo, "a.txt")).toBe(
      LINES.replace("a", "bad").replace("j", "J"),
    );
  });
});

describe("ward run empty commit", () => {
  /** Removes trailing spaces from the files it gets. */
  const TRIM = node(
    "const fs = require('fs'); for (const f of process.argv.slice(1)) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/ +$/gm, ''))",
  );

  /** `a.txt` committed, then only a trailing space staged. */
  function whitespaceOnly(repo: TempRepo, hook: unknown) {
    writeHook(repo, hook);
    repo.commit("init", { "a.txt": "a\n" });
    repo.write("a.txt", "a \n");
    repo.git("add", "a.txt");
  }

  it("fails when the tasks undo every staged change, and reverts", () => {
    using repo = createTempRepo();
    whitespaceOnly(repo, [`${TRIM} {staged_files}`]);

    const { status, stderr } = ward(repo, ["run", "pre-commit"]);

    expect(status).toBe(1);
    expect(stderr).toContain(
      "ward: pre-commit failed: the tasks undid every staged change, so the commit would be empty",
    );
    expect(stderr).toContain("ward: reverted");
    expect(repo.git("diff", "--cached", "--name-only")).toBe("a.txt");
    expect(repo.git("stash", "list")).toBe("");
  });

  it("keeps the fix with --no-revert", () => {
    using repo = createTempRepo();
    whitespaceOnly(repo, [`${TRIM} {staged_files}`]);

    expect(ward(repo, ["run", "pre-commit", "--no-revert"]).status).toBe(1);
    expect(repo.git("diff", "--cached", "--name-only")).toBe("");
    expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe("a\n");
  });

  it("passes when something is left to commit", () => {
    using repo = createTempRepo();
    whitespaceOnly(repo, [`${TRIM} {staged_files}`]);
    repo.write("b.txt", "b\n");
    repo.git("add", "b.txt");

    expect(ward(repo, ["run", "pre-commit"]).status).toBe(0);
    expect(repo.git("diff", "--cached", "--name-only")).toBe("b.txt");
  });

  it("passes when nothing was staged before the run", () => {
    using repo = createTempRepo();
    writeHook(repo, [node("console.log('ran')")]);
    repo.commit("init");

    expect(ward(repo, ["run", "pre-commit"])).toMatchObject({
      status: 0,
      stdout: "ran\n",
    });
  });

  it("only checks pre-commit", () => {
    using repo = createTempRepo();
    repo.write(
      "package.json",
      JSON.stringify({
        ward: { hooks: { "pre-push": [`${TRIM} {all_files}`] } },
      }),
    );
    repo.commit("init", { "a.txt": "a\n" });
    repo.write("a.txt", "a \n");
    repo.git("add", "a.txt");

    expect(
      ward(repo, ["run", "pre-push", "origin", "url"], repo.dir, repo.env, "")
        .status,
    ).toBe(0);
  });
});

describe("ward run --from-ref", () => {
  /** `main` with a.txt, `feature` with b.txt and c.ts checked out; nothing staged. */
  function featureRepo() {
    const repo = createTempRepo();
    repo.commit("base", { "a.txt": "a\n" });
    repo.git("switch", "--quiet", "-c", "feature");
    repo.commit("feature", { "b.txt": "b\n", "c.ts": "c\n" });
    return repo;
  }

  it("gives {staged_files} the files changed since the ref", () => {
    using repo = featureRepo();
    writeHook(repo, `${node(PRINT_ARGS)} {staged_files}`);

    const { status, stdout } = ward(repo, [
      "run",
      "pre-commit",
      "--from-ref",
      "main",
    ]);

    expect(status).toBe(0);
    expect(stdout).toBe("b.txt|c.ts\n");
  });

  it("matches glob-only tasks against the files changed since the ref", () => {
    using repo = featureRepo();
    writeHook(repo, {
      tasks: {
        ts: { run: node("console.log('ts')"), glob: "*.ts" },
        md: { run: node("console.log('md')"), glob: "*.md" },
      },
    });

    const { status, stdout } = ward(repo, [
      "run",
      "pre-commit",
      "--from-ref=main",
    ]);

    expect(status).toBe(0);
    expect(stdout).toBe("ts\n");
  });

  it("leaves fixes unstaged", () => {
    using repo = featureRepo();
    writeHook(repo, `${format()} {staged_files}`);

    const { status } = ward(repo, ["run", "pre-commit", "--from-ref", "main"]);

    expect(status).toBe(0);
    expect(readFileSync(join(repo.dir, "b.txt"), "utf8")).toBe("B\n");
    expect(repo.git("diff", "--cached", "--name-only")).toBe("");
    expect(repo.git("diff", "--name-only")).toBe("b.txt\nc.ts");
  });

  it("gives {push_files} the files changed since the ref, without stdin", () => {
    using repo = featureRepo();
    repo.write(
      "ward.yml",
      `hooks:\n  pre-push: ${JSON.stringify(`${node(PRINT_ARGS)} {push_files}`)}\n`,
    );

    const { status, stdout } = ward(repo, [
      "run",
      "pre-push",
      "--from-ref",
      "main",
    ]);

    expect(status).toBe(0);
    expect(stdout).toBe("b.txt|c.ts\n");
  });

  it("fails with a hint for an unknown ref", () => {
    using repo = featureRepo();
    writeHook(repo, `${node(PRINT_ARGS)} {staged_files}`);

    const { status, stdout, stderr } = ward(repo, [
      "run",
      "pre-commit",
      "--from-ref",
      "origin/main",
    ]);

    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("ward: --from-ref origin/main: no such commit");
    expect(stderr).toContain("fetch-depth: 0");
  });

  it("fails when --from-ref has no ref", () => {
    using repo = featureRepo();

    const { status, stderr } = ward(repo, ["run", "pre-commit", "--from-ref"]);

    expect(status).toBe(1);
    expect(stderr).toContain("ward: --from-ref needs a ref");
  });
});

describe("ward run --all-files", () => {
  /** a.txt and b.ts committed, c.txt staged, d.txt untracked. */
  function repoWithFiles() {
    const repo = createTempRepo();
    repo.commit("base", { "a.txt": "a\n", "b.ts": "b\n" });
    repo.write("c.txt", "c\n");
    repo.git("add", "c.txt");
    repo.write("d.txt", "d\n");
    return repo;
  }

  it("gives {staged_files} every tracked file", () => {
    using repo = repoWithFiles();
    repo.write(
      "ward.yml",
      `hooks:\n  pre-commit: ${JSON.stringify(`${node(PRINT_ARGS)} {staged_files}`)}\n`,
    );

    const { status, stdout } = ward(repo, ["run", "pre-commit", "--all-files"]);

    expect(status).toBe(0);
    expect(stdout).toBe("a.txt|b.ts|c.txt\n");
  });

  it("matches glob-only tasks against every tracked file", () => {
    using repo = repoWithFiles();
    repo.write(
      "ward.yml",
      "hooks:\n  pre-push:\n    tasks:\n" +
        `      ts: { run: ${JSON.stringify(node("console.log('ts')"))}, glob: "*.ts" }\n` +
        `      md: { run: ${JSON.stringify(node("console.log('md')"))}, glob: "*.md" }\n`,
    );

    const { status, stdout } = ward(repo, ["run", "pre-push", "--all-files"]);

    expect(status).toBe(0);
    expect(stdout).toBe("ts\n");
  });

  it("leaves fixes unstaged", () => {
    using repo = repoWithFiles();
    repo.write(
      "ward.yml",
      `hooks:\n  pre-commit: ${JSON.stringify(`${format()} {staged_files}`)}\n`,
    );

    const { status } = ward(repo, ["run", "pre-commit", "--all-files"]);

    expect(status).toBe(0);
    expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe("A\n");
    expect(repo.git("diff", "--cached", "--name-only")).toBe("c.txt");
    expect(repo.git("diff", "--name-only")).toBe("a.txt\nb.ts\nc.txt");
  });

  it("fails together with --from-ref", () => {
    using repo = repoWithFiles();

    const { status, stderr } = ward(repo, [
      "run",
      "pre-commit",
      "--all-files",
      "--from-ref",
      "HEAD",
    ]);

    expect(status).toBe(1);
    expect(stderr).toContain(
      "ward: use either --from-ref or --all-files, not both",
    );
  });
});

describe("ward run --ci", () => {
  /** a.txt and b.txt committed, a clean tree, and a pre-commit hook. */
  function ciRepo(
    hook: string,
    extra = "",
    files: Record<string, string> = {},
  ) {
    const repo = createTempRepo();
    repo.commit("base", {
      "a.txt": "a\n",
      "b.txt": "b\n",
      ...files,
      "ward.yml": `hooks:\n  pre-commit:\n${extra}    tasks:\n      t: { run: ${JSON.stringify(hook)} }\n`,
    });
    return repo;
  }

  function ciRun(repo: TempRepo, flags: string[] = ["--all-files"]) {
    return ward(repo, ["run", "pre-commit", "--ci", ...flags]);
  }

  it("passes when the tasks change nothing", () => {
    using repo = ciRepo(`${node(PRINT_ARGS)} {staged_files}`);

    const { status, stdout, stderr } = ciRun(repo);

    expect(status).toBe(0);
    expect(stdout).toBe("a.txt|b.txt|ward.yml\n");
    expect(stderr).toBe("");
  });

  it("fails, shows the diff and restores the files the tasks changed", () => {
    using repo = ciRepo(`${format()} {staged_files}`);

    const { status, stdout, stderr } = ciRun(repo);

    expect(status).toBe(1);
    expect(stdout).toContain("-a\n+A\n");
    expect(stdout).toContain("-b\n+B\n");
    expect(stderr).toContain(
      "ward: pre-commit failed: the tasks would change 3 files (shown above, now restored). To apply the fixes, run it without --ci: ward run pre-commit --all-files",
    );
    expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe("a\n");
    expect(repo.git("status", "--porcelain")).toBe("");
    expect(repo.git("stash", "list")).toBe("");
  });

  it("names the --from-ref run in the hint", () => {
    using repo = ciRepo(`${format()} {staged_files}`);
    repo.git("switch", "--quiet", "-c", "feature");
    repo.commit("feature", { "c.txt": "c\n" });

    const { status, stderr } = ciRun(repo, ["--from-ref", "main"]);

    expect(status).toBe(1);
    expect(stderr).toContain(
      "the tasks would change 1 file (shown above, now restored). To apply the fixes, run it without --ci: ward run pre-commit --from-ref main",
    );
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  it("catches changes of commands without file placeholders", () => {
    using repo = ciRepo(node("require('fs').writeFileSync('b.txt', 'x')"));

    const { status, stdout } = ciRun(repo);

    expect(status).toBe(1);
    expect(stdout).toContain("+x");
    expect(readFileSync(join(repo.dir, "b.txt"), "utf8")).toBe("b\n");
  });

  it("colors the diff on GitHub Actions", () => {
    using repo = ciRepo(node("require('fs').writeFileSync('b.txt', 'x')"));

    const { status, stdout } = ward(
      repo,
      ["run", "pre-commit", "--ci", "--all-files"],
      repo.dir,
      { ...repo.env, GITHUB_ACTIONS: "true" },
    );

    expect(status).toBe(1);
    expect(stdout).toContain("\u001b[");
    expect(stripVTControlCharacters(stdout)).toContain("+x");
  });

  it("lists and deletes the files the tasks created", () => {
    using repo = ciRepo(node("require('fs').writeFileSync('gen.txt', 'g')"));
    repo.write("mine.txt", "untracked before the run\n");

    const { status, stdout, stderr } = ciRun(repo);

    expect(status).toBe(1);
    expect(stdout).toBe("new file: gen.txt\n");
    expect(stderr).toContain("the tasks would change 1 file");
    expect(existsSync(join(repo.dir, "gen.txt"))).toBe(false);
    expect(existsSync(join(repo.dir, "mine.txt"))).toBe(true);
  });

  it("fails with the task's exit code and restores the tree", () => {
    using repo = ciRepo(`${format(3)} {staged_files}`);

    const { status } = ciRun(repo);

    expect(status).toBe(3);
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  it("keeps uncommitted changes that were there before the run", () => {
    using repo = ciRepo(`${format()} {staged_files}`);
    repo.write("a.txt", "staged\n");
    repo.git("add", "a.txt");
    repo.write("b.txt", "unstaged\n");

    const { status } = ciRun(repo);

    expect(status).toBe(1);
    expect(repo.git("show", ":a.txt")).toBe("staged");
    expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe("staged\n");
    expect(readFileSync(join(repo.dir, "b.txt"), "utf8")).toBe("unstaged\n");
    expect(repo.git("stash", "list")).toBe("");
  });

  it("restores the tree even when the config turns off backup and revert", () => {
    using repo = ciRepo(
      `${format()} {staged_files}`,
      "    backup: false\n    revert: false\n",
    );

    const { status } = ciRun(repo);

    expect(status).toBe(1);
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  describe("in GitHub Actions", () => {
    function githubRun(repo: TempRepo, flags: string[] = ["--all-files"]) {
      const env = { ...repo.env, GITHUB_ACTIONS: "true" };
      return ward(repo, ["run", "pre-commit", "--ci", ...flags], repo.dir, env);
    }

    function annotations(stdout: string): string[] {
      return stdout.split("\n").filter((line) => line.startsWith("::"));
    }

    it("annotates the lines the tasks would change", () => {
      using repo = ciRepo(`${format()} {staged_files}`, "", {
        "a.txt": "ok\nfix me\nfix me too\nOK\n",
      });

      const { status, stdout } = githubRun(repo);

      expect(status).toBe(1);
      const message =
        "the tasks would change this; to apply the fixes, run: ward run pre-commit --all-files";
      expect(annotations(stdout)).toEqual([
        `::error file=a.txt,line=1,endLine=3,title=ward%3A pre-commit --ci::${message}`,
        `::error file=b.txt,line=1,title=ward%3A pre-commit --ci::${message}`,
        `::error file=ward.yml,line=1,endLine=4,title=ward%3A pre-commit --ci::${message}`,
      ]);
    });

    it("annotates the files the tasks would create", () => {
      using repo = ciRepo(node("require('fs').writeFileSync('gen.txt', 'g')"));

      const { status, stdout } = githubRun(repo);

      expect(status).toBe(1);
      expect(annotations(stdout)).toEqual([
        "::error title=ward%3A pre-commit --ci::the tasks would create gen.txt; to apply the fixes, run: ward run pre-commit --all-files",
      ]);
    });

    it("annotates a failed task", () => {
      using repo = ciRepo(node("process.exit(3)"));

      const { status, stdout } = githubRun(repo);

      expect(status).toBe(3);
      expect(annotations(stdout)).toEqual([
        "::error title=ward%3A pre-commit::t (exit 3): see the log of this step",
      ]);
    });

    it("prints nothing extra when the check passes", () => {
      using repo = ciRepo(`${node(PRINT_ARGS)} {staged_files}`);

      const { status, stdout } = githubRun(repo);

      expect(status).toBe(0);
      expect(stdout).toBe("a.txt|b.txt|ward.yml\n");
    });
  });

  it.each([
    [["--ci"], "--ci needs the files to check"],
    [["--ci", "--all-files", "--no-backup"], "--ci always backs up"],
    [["--ci", "--all-files", "--no-revert"], "--ci always backs up"],
  ])("rejects %j", (flags, message) => {
    using repo = ciRepo("true");

    const { status, stderr } = ward(repo, ["run", "pre-commit", ...flags]);

    expect(status).toBe(1);
    expect(stderr).toContain(`ward: ${message}`);
  });
});

describe("parseRunArgs", () => {
  it("reads Ward's flags right after the hook name", () => {
    expect(parseRunArgs(["pre-commit", "--no-backup", "a", "b"])).toEqual({
      hook: "pre-commit",
      args: ["a", "b"],
      backup: false,
    });
    expect(parseRunArgs(["pre-commit", "--no-revert", "--no-backup"])).toEqual({
      hook: "pre-commit",
      args: [],
      backup: false,
      revert: false,
    });
  });

  it("passes everything from the first other argument to the hook", () => {
    expect(parseRunArgs(["commit-msg", "msg", "--no-backup"])).toEqual({
      hook: "commit-msg",
      args: ["msg", "--no-backup"],
    });
    expect(parseRunArgs(["pre-push", "--other", "--no-backup"])).toEqual({
      hook: "pre-push",
      args: ["--other", "--no-backup"],
    });
  });

  it("ends Ward's flags at `--`", () => {
    expect(parseRunArgs(["pre-push", "--", "--no-backup"])).toEqual({
      hook: "pre-push",
      args: ["--no-backup"],
    });
  });

  it("leaves the hook undefined without arguments", () => {
    expect(parseRunArgs([])).toEqual({ hook: undefined, args: [] });
  });

  it("reads --from-ref with the ref as the next or an inline value", () => {
    expect(
      parseRunArgs(["pre-commit", "--from-ref", "origin/main", "--no-backup"]),
    ).toEqual({
      hook: "pre-commit",
      args: [],
      backup: false,
      fromRef: "origin/main",
    });
    expect(parseRunArgs(["pre-commit", "--from-ref=main"])).toEqual({
      hook: "pre-commit",
      args: [],
      fromRef: "main",
    });
  });

  it.each([
    [["pre-commit", "--from-ref"]],
    [["pre-commit", "--from-ref="]],
    [["pre-commit", "--from-ref", "--no-backup"]],
    [["pre-commit", "--from-ref=-x"]],
  ])("rejects --from-ref without a ref: %j", (argv) => {
    expect(() => parseRunArgs(argv)).toThrow("--from-ref needs a ref");
  });

  it("reads --all-files", () => {
    expect(parseRunArgs(["pre-commit", "--all-files", "--no-revert"])).toEqual({
      hook: "pre-commit",
      args: [],
      allFiles: true,
      revert: false,
    });
  });

  it("reads --ci", () => {
    expect(parseRunArgs(["pre-commit", "--ci", "--from-ref", "main"])).toEqual({
      hook: "pre-commit",
      args: [],
      ci: true,
      fromRef: "main",
    });
  });

  it("rejects --all-files together with --from-ref", () => {
    expect(() =>
      parseRunArgs(["pre-commit", "--from-ref", "main", "--all-files"]),
    ).toThrow("use either --from-ref or --all-files, not both");
  });

  it("passes --from-ref after the hook args to the hook", () => {
    expect(parseRunArgs(["commit-msg", "msg", "--from-ref", "main"])).toEqual({
      hook: "commit-msg",
      args: ["msg", "--from-ref", "main"],
    });
  });
});

// Through the stubs: git runs the hook, the hook runs `ward run`.

/** Install the stubs, with `node_modules/.bin/ward` pointing at the source CLI. */
function installStubs(repo: TempRepo) {
  writeWardBin(repo);
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

  posixOnly("updates stubs from an older Ward on the next commit", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  pre-commit: exit 0\n");
    installStubs(repo);
    const hooksDir = join(repo.dir, ".git", "hooks");
    const current = readFileSync(join(hooksDir, "pre-commit"), "utf8");
    for (const hook of HOOKS) {
      const file = join(hooksDir, hook);
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(MARKER_CURRENT, "# ward:managed v1"),
      );
    }

    const result = commit(repo);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "ward: updated the git hook stubs for this Ward version",
    );
    expect(readFileSync(join(hooksDir, "pre-commit"), "utf8")).toBe(current);
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

  posixOnly("backs up during `git commit -a` and drops the backup", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n" });
    repo.write(
      "ward.yml",
      "hooks:\n  pre-commit: git stash list --format=%gs\n",
    );
    installStubs(repo);
    repo.git("add", "ward.yml");
    repo.write("a.txt", "a2\n");

    const result = spawnSync("git", ["commit", "-a", "-m", "next"], {
      cwd: repo.dir,
      env: repo.env,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    // Git sends hook output to stderr.
    expect(result.stderr).toContain("ward backup");
    expect(repo.git("stash", "list")).toBe("");
    expect(repo.git("show", "HEAD:a.txt")).toBe("a2");
  });

  posixOnly("commits fixed staged changes and keeps unstaged ones", () => {
    using repo = createTempRepo();
    const lines = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
    repo.commit("init", { "a.txt": lines });
    repo.write(
      "ward.yml",
      `hooks:\n  pre-commit: ${JSON.stringify(`${node("const fs = require('fs'); for (const f of process.argv.slice(1)) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('bad', 'good'))")} {staged_files}`)}\n`,
    );
    installStubs(repo);
    repo.git("add", "ward.yml");
    repo.write("a.txt", lines.replace("a", "bad"));
    repo.git("add", "a.txt");
    repo.write("a.txt", lines.replace("a", "bad").replace("j", "J"));

    const result = spawnSync("git", ["commit", "-m", "next"], {
      cwd: repo.dir,
      env: repo.env,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(repo.git("show", "HEAD:a.txt")).toBe(
      lines.replace("a", "good").trim(),
    );
    expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe(
      lines.replace("a", "good").replace("j", "J"),
    );
    expect(repo.git("status", "--porcelain", "--untracked-files=no")).toBe(
      "M a.txt",
    );
  });

  posixOnly("reverts a failed `git commit -a` to the state before it", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "b.txt": "b\n" });
    repo.write(
      "ward.yml",
      `hooks:\n  pre-commit: [${JSON.stringify(`${format()} {staged_files}`)}, exit 5]\n`,
    );
    installStubs(repo);
    repo.git("add", "ward.yml");
    repo.write("a.txt", "a2\n");
    repo.write("b.txt", "b2\n");
    repo.git("add", "b.txt");
    const status = repo.git("status", "--porcelain", "--untracked-files=no");

    const result = spawnSync("git", ["commit", "-a", "-m", "next"], {
      cwd: repo.dir,
      env: repo.env,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ward: reverted");
    expect(repo.git("log", "--format=%s")).toBe("init");
    expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe("a2\n");
    expect(readFileSync(join(repo.dir, "b.txt"), "utf8")).toBe("b2\n");
    expect(repo.git("status", "--porcelain", "--untracked-files=no")).toBe(
      status,
    );
    expect(repo.git("stash", "list")).toBe("");
  });

  posixOnly("blocks a commit the tasks emptied, allows --allow-empty", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n" });
    repo.write(
      "ward.yml",
      `hooks:\n  pre-commit: ${JSON.stringify(`${node("const fs = require('fs'); for (const f of process.argv.slice(1)) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/ +$/gm, ''))")} {staged_files}`)}\n`,
    );
    installStubs(repo);
    repo.git("add", "ward.yml");
    repo.git("commit", "--quiet", "--no-verify", "-m", "config");
    repo.write("a.txt", "a \n");
    repo.git("add", "a.txt");

    const blocked = spawnSync("git", ["commit", "-m", "spaces"], {
      cwd: repo.dir,
      env: repo.env,
      encoding: "utf8",
    });
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("the commit would be empty");
    expect(repo.git("log", "--format=%s")).toBe("config\ninit");
    expect(repo.git("diff", "--cached", "--name-only")).toBe("a.txt");

    repo.git("restore", "--staged", "--worktree", "a.txt");
    const empty = spawnSync("git", ["commit", "--allow-empty", "-m", "empty"], {
      cwd: repo.dir,
      env: repo.env,
      encoding: "utf8",
    });
    expect(empty.status).toBe(0);
    expect(repo.git("log", "-1", "--format=%s")).toBe("empty");
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
