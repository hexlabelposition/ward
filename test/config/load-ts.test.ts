import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

const LOADER = pathToFileURL(
  resolve(import.meta.dirname, "../../src/config/load-ts.ts"),
).href;

/**
 * Load in a real Node process: vitest would run the config through Vite,
 * which accepts TS syntax that Node's type stripping rejects.
 */
function load(repo: TempRepo, file = "ward.config.ts") {
  const script = `
    const { loadTsConfig } = await import(${JSON.stringify(LOADER)});
    try {
      console.log(JSON.stringify({ ok: await loadTsConfig(process.argv[1]) }));
    } catch (error) {
      console.log(JSON.stringify({ name: error.name, message: error.message }));
    }
  `;
  const { stdout, stderr } = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, join(repo.dir, file)],
    { cwd: repo.dir, env: repo.env, encoding: "utf8" },
  );
  if (!stdout) throw new Error(stderr);
  return JSON.parse(stdout) as {
    ok?: unknown;
    name?: string;
    message?: string;
  };
}

describe("loadTsConfig", () => {
  it("returns the default export", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.config.ts",
      `type Hooks = Record<string, string>;
const hooks: Hooks = { "pre-commit": "npm test" };
export default hooks;
`,
    );

    expect(load(repo)).toEqual({ ok: { "pre-commit": "npm test" } });
  });

  it("loads without a package.json type", () => {
    using repo = createTempRepo();
    repo.write("package.json", "{}");
    repo.write("ward.config.ts", "export default { a: 1 as number };\n");

    expect(load(repo)).toEqual({ ok: { a: 1 } });
  });

  it("fails without a default export", () => {
    using repo = createTempRepo();
    repo.write("ward.config.ts", "export const config = {};\n");

    expect(load(repo)).toEqual({
      name: "ConfigError",
      message:
        "ward.config.ts has no default export: use `export default defineConfig({ ... })`",
    });
  });

  it("explains syntax Node can't strip", () => {
    using repo = createTempRepo();
    repo.write("ward.config.ts", "export default {};\nenum A { B }\n");

    const { name, message } = load(repo);

    expect(name).toBe("ConfigError");
    expect(message).toMatch(/^ward\.config\.ts:2: TypeScript enum/);
    expect(message).toContain("Node only strips types");
    expect(message).toContain("\n  enum A { B }\n  ^^^");
  });

  it("points at syntax errors", () => {
    using repo = createTempRepo();
    repo.write("ward.config.ts", "export default {\n  a: ,\n};\n");

    const { name, message } = load(repo);

    expect(name).toBe("ConfigError");
    expect(message).toMatch(/^ward\.config\.ts:2: /);
    expect(message).toContain("\n    a: ,\n       ^");
  });

  it("reports errors thrown by the config", () => {
    using repo = createTempRepo();
    repo.write("ward.config.ts", 'throw new Error("boom");\n');

    expect(load(repo)).toEqual({
      name: "ConfigError",
      message: "ward.config.ts: boom",
    });
  });

  it("reports missing imports", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.config.ts",
      'import { defineConfig } from "nope-pkg";\nexport default defineConfig({});\n',
    );

    expect(load(repo).message).toMatch(
      /^ward\.config\.ts: Cannot find package 'nope-pkg'/,
    );
  });
});
