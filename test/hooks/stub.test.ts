import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getStubVersion,
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
function commit(repo: TempRepo, cwd = repo.dir) {
  execFileSync("git", ["commit", "--allow-empty", "--quiet", "-m", "msg"], {
    cwd,
    env: repo.env,
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

  it("uses a custom bin path", () => {
    using repo = createTempRepo();
    writeFakeBin(repo, "tools/ward");
    installStub(repo, renderStub("pre-commit", { bin: "tools/ward" }));

    commit(repo);

    expect(calledWith(repo)).toBe("run pre-commit");
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
