import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { install } from "../../src/cli/install.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

// In-process: the TTY prompt is replaced by a `confirm` stub.
describe("install (confirm)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function quiet() {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  }

  it("asks about foreign hooks and chains on yes", async () => {
    quiet();
    using repo = createTempRepo();
    repo.write(".git/hooks/pre-push", "#!/bin/sh\ngit lfs pre-push\n");
    const confirm = vi.fn(() => Promise.resolve(true));

    expect(await install({ cwd: repo.dir, env: repo.env, confirm })).toBe(0);

    expect(confirm).toHaveBeenCalledWith(["pre-push"], ".git/hooks");
    expect(
      readFileSync(join(repo.dir, ".git/hooks/pre-push.pre-ward"), "utf8"),
    ).toBe("#!/bin/sh\ngit lfs pre-push\n");
  });

  it("leaves foreign hooks on no", async () => {
    quiet();
    using repo = createTempRepo();
    repo.write(".git/hooks/pre-push", "#!/bin/sh\ngit lfs pre-push\n");

    await install({
      cwd: repo.dir,
      env: repo.env,
      confirm: () => Promise.resolve(false),
    });

    expect(existsSync(join(repo.dir, ".git/hooks/pre-push.pre-ward"))).toBe(
      false,
    );
    expect(readFileSync(join(repo.dir, ".git/hooks/pre-push"), "utf8")).toBe(
      "#!/bin/sh\ngit lfs pre-push\n",
    );
  });

  it("does not ask without foreign hooks or with --chain", async () => {
    quiet();
    using repo = createTempRepo();
    const confirm = vi.fn(() => Promise.resolve(true));

    await install({ cwd: repo.dir, env: repo.env, confirm });
    repo.write(".git/hooks/pre-push.sample", "sample\n");
    await install({ cwd: repo.dir, env: repo.env, confirm });
    expect(confirm).not.toHaveBeenCalled();

    repo.write(".git/hooks/commit-msg", "foreign\n");
    await install({ cwd: repo.dir, env: repo.env, confirm, chain: true });
    expect(confirm).not.toHaveBeenCalled();
  });
});
