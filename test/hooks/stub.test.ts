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
