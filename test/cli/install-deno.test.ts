import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { install } from "../../src/cli/install.ts";
import { createTempRepo } from "../helpers/git-repo.ts";
import { CLI } from "../helpers/ward-bin.ts";

/** Deno is optional locally. */
const hasDeno = spawnSync("deno", ["--version"]).status === 0;

const DENO_WARD = "deno run -A npm:@hexlabelposition/ward";

function hook(dir: string, name: string) {
  return readFileSync(join(dir, ".git", "hooks", name), "utf8");
}

describe("install on deno", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes deno stubs and tells to rerun with deno", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    using repo = createTempRepo();
    repo.write(".git/hooks/pre-commit", "#!/bin/sh\necho mine\n");

    const code = await install({
      cwd: repo.dir,
      env: repo.env,
      runtime: "deno",
      confirm: null,
    });

    expect(code).toBe(0);
    expect(hook(repo.dir, "pre-push")).toContain('"${WARD_RUNTIME:-deno}"');
    const output = warn.mock.calls.flat().join("\n");
    expect(output).toContain(`${DENO_WARD} --chain`);
    expect(output).toContain(`${DENO_WARD} --force`);
  });

  it("tells to rerun with deno when core.hooksPath is set", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    using repo = createTempRepo();
    repo.git("config", "core.hooksPath", ".githooks");

    const code = await install({
      cwd: repo.dir,
      env: repo.env,
      runtime: "deno",
      confirm: null,
    });

    expect(code).toBe(1);
    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain(`then run: ${DENO_WARD}`);
    expect(output).toContain(`${DENO_WARD} --respect-hooks-path`);
  });

  // `deno install` has no `prepare` lifecycle: the user runs the task.
  it.runIf(hasDeno)(
    "installs from a deno.json task",
    { timeout: 60_000 },
    () => {
      using repo = createTempRepo();
      // The source CLI stands in for npm:@hexlabelposition/ward; --no-config
      // keeps this repo's deno.json from resolving its imports.
      repo.write(
        "deno.json",
        JSON.stringify({
          tasks: {
            prepare: `deno run -A --no-config ${JSON.stringify(CLI.replaceAll("\\", "/"))}`,
          },
        }),
      );

      const { status, stdout, stderr } = spawnSync(
        "deno",
        ["task", "prepare"],
        { cwd: repo.dir, env: repo.env, encoding: "utf8" },
      );

      expect(stderr).not.toContain("error");
      expect(status).toBe(0);
      expect(stdout).toContain("hooks installed in .git/hooks");
      expect(hook(repo.dir, "pre-commit")).toContain('"${WARD_RUNTIME:-deno}"');
    },
  );
});
