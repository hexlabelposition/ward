import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getStubVersion,
  readStubOptions,
  isManagedStub,
  renderStub,
  STUB_VERSION,
} from "../../src/hooks/stub.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

const posixOnly = process.platform === "win32" ? it.skip : it;

/** Install a stub as a real hook so git itself runs it (works on Windows via Git's sh). */
function installStub(repo: TempRepo, stub: string) {
  const file = join(repo.dir, ".git", "hooks", "pre-commit");
  writeFileSync(file, stub);
  chmodSync(file, 0o755);
}

/** Fake ward binary that records its args in the cwd, then exits with `code`. */
function writeFakeBin(repo: TempRepo, path: string, code = 0) {
  repo.write(
    path,
    `#!/bin/sh\necho "$*" > ward-called.txt\nexit ${String(code)}\n`,
  );
  chmodSync(join(repo.dir, path), 0o755);
}

/** Commit with hooks enabled (no --no-verify, unlike repo.commit()). */
function commit(repo: TempRepo, cwd = repo.dir, env = repo.env) {
  execFileSync("git", ["commit", "--allow-empty", "--quiet", "-m", "msg"], {
    cwd,
    env,
    stdio: "pipe",
  });
}

function calledWith(repo: TempRepo) {
  return readFileSync(join(repo.dir, "ward-called.txt"), "utf8").trim();
}

describe("renderStub", () => {
  it("starts with a shebang and the marker", () => {
    const lines = renderStub("pre-commit").split("\n");
    expect(lines[0]).toBe("#!/bin/sh");
    expect(lines[1]).toBe(`# ward:managed v${String(STUB_VERSION)}`);
  });

  it("uses LF line endings only", () => {
    expect(renderStub("pre-commit")).not.toContain("\r");
  });

  it("quotes a custom bin path", () => {
    expect(renderStub("pre-commit", { bin: "it's/ward" })).toContain(
      `bin='it'\\''s/ward'`,
    );
  });

  it("calls ward run with the hook name from the repo root", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit"));

    commit(repo);

    expect(calledWith(repo)).toBe("run pre-commit");
  });

  it("finds the binary when git runs from a subdirectory", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit"));
    const sub = join(repo.dir, "packages", "a");
    mkdirSync(sub, { recursive: true });

    commit(repo, sub);

    expect(calledWith(repo)).toBe("run pre-commit");
  });

  it("propagates the exit code of ward", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward", 3);
    installStub(repo, renderStub("pre-commit"));

    expect(() => {
      commit(repo);
    }).toThrow();
  });

  it("lets git continue when the binary is missing", () => {
    using repo = createTempRepo();
    installStub(repo, renderStub("pre-commit"));

    expect(() => {
      commit(repo);
    }).not.toThrow();
    expect(repo.git("log", "--format=%s")).toBe("msg");
  });

  it("skips ward with WARD=0", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward", 3);
    installStub(repo, renderStub("pre-commit"));

    commit(repo, repo.dir, { ...repo.env, WARD: "0" });

    expect(repo.git("log", "--format=%s")).toBe("msg");
    expect(existsSync(join(repo.dir, "ward-called.txt"))).toBe(false);
  });

  it("runs ward for other values of WARD", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit"));

    commit(repo, repo.dir, { ...repo.env, WARD: "1" });

    expect(calledWith(repo)).toBe("run pre-commit");
  });

  it("still runs a chained hook with WARD=0", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit"));
    const prev = join(repo.dir, ".git", "hooks", "pre-commit.pre-ward");
    writeFileSync(prev, "#!/bin/sh\nexit 5\n");
    chmodSync(prev, 0o755);

    expect(() => {
      commit(repo, repo.dir, { ...repo.env, WARD: "0" });
    }).toThrow();
  });

  it("uses a custom bin path", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "tools/ward");
    installStub(repo, renderStub("pre-commit", { bin: "tools/ward" }));

    commit(repo);

    expect(calledWith(repo)).toBe("run pre-commit");
  });
});

describe("runtime", () => {
  /** Fake `bun` in its own dir that records its args, then runs the binary with sh. */
  function fakeBun(repo: TempRepo): NodeJS.ProcessEnv {
    const dir = join(repo.dir, ".fake-bin");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "bun"),
      `#!/bin/sh\necho "bun $*" > bun-called.txt\nexec sh "$@"\n`,
    );
    chmodSync(join(dir, "bun"), 0o755);
    return { ...repo.env, PATH: `${dir}${delimiter}${repo.env.PATH ?? ""}` };
  }

  /** Fake `deno` in its own dir that records its args, then exits with `code`. */
  function fakeDeno(repo: TempRepo, code = 0): NodeJS.ProcessEnv {
    const dir = join(repo.dir, ".fake-deno");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "deno"),
      `#!/bin/sh\necho "deno $*" > deno-called.txt\nexit ${String(code)}\n`,
    );
    chmodSync(join(dir, "deno"), 0o755);
    return { ...repo.env, PATH: `${dir}${delimiter}${repo.env.PATH ?? ""}` };
  }

  function denoCalledWith(repo: TempRepo) {
    return readFileSync(join(repo.dir, "deno-called.txt"), "utf8").trim();
  }

  function bunCalledWith(repo: TempRepo) {
    return readFileSync(join(repo.dir, "bun-called.txt"), "utf8").trim();
  }

  /** Commit with hooks enabled; returns git's exit code and stderr. */
  function tryCommit(repo: TempRepo, env: NodeJS.ProcessEnv) {
    const { status, stderr } = spawnSync(
      "git",
      ["commit", "--allow-empty", "--quiet", "-m", "msg"],
      { cwd: repo.dir, env, encoding: "utf8" },
    );
    return { status, stderr };
  }

  it("defaults to the runtime from install", () => {
    expect(renderStub("pre-commit")).toContain('"${WARD_RUNTIME:-node}"');
    expect(renderStub("pre-commit", { runtime: "bun" })).toContain(
      '"${WARD_RUNTIME:-bun}"',
    );
    expect(renderStub("pre-commit", { runtime: "deno" })).toContain(
      '"${WARD_RUNTIME:-deno}"',
    );
  });

  it("runs ward from npm in a deno stub, without node_modules", () => {
    using repo = createTempRepo();
    installStub(repo, renderStub("pre-commit", { runtime: "deno" }));

    commit(repo, repo.dir, fakeDeno(repo));

    expect(denoCalledWith(repo)).toBe(
      "deno run -A npm:@hexlabelposition/ward run pre-commit",
    );
  });

  it("propagates the exit code of deno", () => {
    using repo = createTempRepo();
    installStub(repo, renderStub("pre-commit", { runtime: "deno" }));

    const { status } = tryCommit(repo, fakeDeno(repo, 3));

    expect(status).not.toBe(0);
    expect(repo.git("rev-list", "--all", "--count")).toBe("0");
  });

  it("skips deno with WARD=0", () => {
    using repo = createTempRepo();
    installStub(repo, renderStub("pre-commit", { runtime: "deno" }));

    commit(repo, repo.dir, { ...fakeDeno(repo, 3), WARD: "0" });

    expect(existsSync(join(repo.dir, "deno-called.txt"))).toBe(false);
  });

  it("runs on deno with WARD_RUNTIME=deno in a node stub", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit"));

    commit(repo, repo.dir, { ...fakeDeno(repo), WARD_RUNTIME: "deno" });

    expect(denoCalledWith(repo)).toBe(
      "deno run -A npm:@hexlabelposition/ward run pre-commit",
    );
    expect(existsSync(join(repo.dir, "ward-called.txt"))).toBe(false);
  });

  it("runs the binary with WARD_RUNTIME=node in a deno stub", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit", { runtime: "deno" }));

    commit(repo, repo.dir, { ...fakeDeno(repo), WARD_RUNTIME: "node" });

    expect(calledWith(repo)).toBe("run pre-commit");
    expect(existsSync(join(repo.dir, "deno-called.txt"))).toBe(false);
  });

  posixOnly("fails with a hint when deno is not installed", () => {
    using repo = createTempRepo();
    repo.write("stub", renderStub("pre-commit", { runtime: "deno" }));

    const { status, stderr } = spawnSync("/bin/sh", ["stub"], {
      cwd: repo.dir,
      env: { ...repo.env, PATH: join(repo.dir, "empty") },
      encoding: "utf8",
    });

    expect(status).not.toBe(0);
    expect(stderr).toContain("ward: deno not found in PATH");
  });

  it("starts the binary with bun in a bun stub", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit", { runtime: "bun" }));

    commit(repo, repo.dir, fakeBun(repo));

    expect(bunCalledWith(repo)).toBe(
      "bun node_modules/.bin/ward run pre-commit",
    );
    expect(calledWith(repo)).toBe("run pre-commit");
  });

  it("runs on bun with WARD_RUNTIME=bun in a node stub", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit"));

    commit(repo, repo.dir, { ...fakeBun(repo), WARD_RUNTIME: "bun" });

    expect(bunCalledWith(repo)).toBe(
      "bun node_modules/.bin/ward run pre-commit",
    );
  });

  it("runs the binary directly with WARD_RUNTIME=node in a bun stub", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit", { runtime: "bun" }));

    commit(repo, repo.dir, { ...fakeBun(repo), WARD_RUNTIME: "node" });

    expect(calledWith(repo)).toBe("run pre-commit");
    expect(existsSync(join(repo.dir, "bun-called.txt"))).toBe(false);
  });

  it("uses the default for an empty WARD_RUNTIME", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit"));

    commit(repo, repo.dir, { ...fakeBun(repo), WARD_RUNTIME: "" });

    expect(calledWith(repo)).toBe("run pre-commit");
    expect(existsSync(join(repo.dir, "bun-called.txt"))).toBe(false);
  });

  it("fails on an unknown WARD_RUNTIME", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    installStub(repo, renderStub("pre-commit"));

    const { status, stderr } = tryCommit(repo, {
      ...repo.env,
      WARD_RUNTIME: "nodejs",
    });

    expect(status).not.toBe(0);
    expect(stderr).toContain(
      'ward: unknown WARD_RUNTIME="nodejs", expected node, bun or deno',
    );
    expect(existsSync(join(repo.dir, "ward-called.txt"))).toBe(false);
  });

  // Runs the stub itself with an empty PATH: bun is often next to git and sh
  // (/usr/bin), so it can't be dropped from PATH for a real commit.
  posixOnly("fails with a hint when bun is not installed", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "node_modules/.bin/ward");
    repo.write("stub", renderStub("pre-commit", { runtime: "bun" }));

    const { status, stderr } = spawnSync("/bin/sh", ["stub"], {
      cwd: repo.dir,
      env: { ...repo.env, PATH: join(repo.dir, "empty") },
      encoding: "utf8",
    });

    expect(status).not.toBe(0);
    expect(stderr).toContain("ward: bun not found in PATH");
    expect(stderr).toContain("WARD_RUNTIME=node");
    expect(existsSync(join(repo.dir, "ward-called.txt"))).toBe(false);
  });
});

describe("getStubVersion", () => {
  it("reads the version of a rendered stub", () => {
    expect(getStubVersion(renderStub("commit-msg"))).toBe(STUB_VERSION);
  });

  it("reads other versions", () => {
    expect(getStubVersion("#!/bin/sh\n# ward:managed v7\n")).toBe(7);
  });

  it.each([
    "",
    "#!/bin/sh\nnpx lint-staged\n",
    "#!/bin/sh\n# ward:managed\n",
    "#!/bin/sh\necho '# ward:managed v1 is not a marker'\n",
  ])("returns null for a foreign hook %#", (content) => {
    expect(getStubVersion(content)).toBeNull();
    expect(isManagedStub(content)).toBe(false);
  });
});

describe("readStubOptions", () => {
  it.each([
    { bin: "node_modules/.bin/ward", runtime: "node" },
    { bin: "dist/cli.mjs", runtime: "bun" },
    { bin: "my tools/it's ward", runtime: "deno" },
  ] as const)("reads back the options of a rendered stub: %j", (options) => {
    expect(readStubOptions(renderStub("pre-push", options))).toEqual(options);
  });

  it("reads a v1 stub, which always ran Node", () => {
    const v1 = "#!/bin/sh\n# ward:managed v1\nbin='node_modules/.bin/ward'\n";
    expect(readStubOptions(v1)).toEqual({
      bin: "node_modules/.bin/ward",
      runtime: "node",
    });
  });

  it("returns null without the bin line", () => {
    expect(readStubOptions("#!/bin/sh\n# ward:managed v9\n")).toBeNull();
  });
});

describe("chained hooks", () => {
  /** Hook script that appends `<name>|<args>|<stdin>` to log.txt in the repo root. */
  function logger(name: string, code = 0) {
    return `#!/bin/sh\nprintf '%s|%s|%s\\n' ${name} "$*" "$(cat)" >> log.txt\nexit ${String(code)}\n`;
  }

  function setup(hook: "pre-commit" | "pre-push", prevCode = 0) {
    const repo = createTempRepo();
    repo.write("node_modules/.bin/ward", logger("ward"));
    chmodSync(join(repo.dir, "node_modules/.bin/ward"), 0o755);
    const hooksDir = join(repo.dir, ".git", "hooks");
    writeFileSync(join(hooksDir, `${hook}.pre-ward`), logger("prev", prevCode));
    chmodSync(join(hooksDir, `${hook}.pre-ward`), 0o755);
    writeFileSync(join(hooksDir, hook), renderStub(hook));
    chmodSync(join(hooksDir, hook), 0o755);
    return repo;
  }

  function log(repo: TempRepo) {
    return readFileSync(join(repo.dir, "log.txt"), "utf8").trim().split("\n");
  }

  it("runs the previous hook first, then ward", () => {
    using repo = setup("pre-commit");

    commit(repo);

    expect(log(repo).map((line) => line.split("|")[0])).toEqual([
      "prev",
      "ward",
    ]);
  });

  it("stops when the previous hook fails", () => {
    using repo = setup("pre-commit", 1);

    expect(() => {
      commit(repo);
    }).toThrow();
    expect(log(repo).map((line) => line.split("|")[0])).toEqual(["prev"]);
  });

  posixOnly("ignores a previous hook that is not executable", () => {
    using repo = setup("pre-commit");
    chmodSync(join(repo.dir, ".git/hooks/pre-commit.pre-ward"), 0o644);

    commit(repo);

    expect(log(repo).map((line) => line.split("|")[0])).toEqual(["ward"]);
  });

  it("passes pre-push args and stdin to both hooks", () => {
    using repo = setup("pre-push");
    using remote = createTempRepo({ init: false });
    repo.git("init", "--quiet", "--bare", remote.dir);
    repo.git("remote", "add", "origin", remote.dir);
    repo.commit("init");
    const sha = repo.git("rev-parse", "HEAD");

    execFileSync("git", ["push", "--quiet", "origin", "main"], {
      cwd: repo.dir,
      env: repo.env,
      stdio: "pipe",
    });

    const lines = log(repo);
    expect(lines).toHaveLength(2);
    const expected = [
      ["prev", /^origin /],
      ["ward", /^run pre-push origin /],
    ] as const;
    for (const [i, [name, argsRe]] of expected.entries()) {
      const [who, args, stdin] = (lines[i] ?? "").split("|");
      expect(who).toBe(name);
      expect(args).toMatch(argsRe);
      expect(stdin).toBe(
        `refs/heads/main ${sha} refs/heads/main ${"0".repeat(40)}`,
      );
    }
  });
});
