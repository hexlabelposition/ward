import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

const LOADER = pathToFileURL(
  resolve(import.meta.dirname, "../../src/config/load-ts.ts"),
).href;

type Runtime = "node" | "bun" | "deno";

/**
 * Node from PATH when the tests run on Bun or Deno. `bun --bun` puts a `node` that is
 * Bun itself first in PATH (`/tmp/bun-node-*`), so skip that one.
 */
function findNode(): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (basename(dir).startsWith("bun-node-")) continue;
    for (const name of ["node", "node.exe"]) {
      const file = join(dir, name);
      if (existsSync(file) && !basename(realpathSync(file)).startsWith("bun")) {
        return file;
      }
    }
  }
  return undefined;
}

const nodePath =
  process.versions.bun === undefined && process.versions.deno === undefined
    ? process.execPath
    : findNode();

const RUNTIMES: Record<Runtime, { cmd: string; args: string[] }> = {
  node: { cmd: nodePath ?? "node", args: ["--input-type=module", "-e"] },
  bun: { cmd: "bun", args: ["-e"] },
  // `deno eval` has all permissions.
  deno: { cmd: "deno", args: ["eval"] },
};

/** Bun is optional locally; CI installs it for every test job. */
const hasBun = spawnSync("bun", ["--version"]).status === 0;

/** Deno is optional locally; CI installs it for the Deno test job. */
const hasDeno = spawnSync("deno", ["--version"]).status === 0;

/**
 * Load in a real runtime process: vitest would run the config through Vite,
 * which accepts TS syntax that Node's type stripping rejects.
 */
function load(repo: TempRepo, runtime: Runtime, file = "ward.config.ts") {
  const script = `
    const { loadTsConfig } = await import(${JSON.stringify(LOADER)});
    try {
      // The last argument: deno eval puts its eval file before it.
      console.log(JSON.stringify({ ok: await loadTsConfig(process.argv.at(-1)) }));
    } catch (error) {
      console.log(JSON.stringify({ name: error.name, message: error.message }));
    }
  `;
  const { cmd, args } = RUNTIMES[runtime];
  const { stdout, stderr } = spawnSync(
    cmd,
    [...args, script, join(repo.dir, file)],
    { cwd: repo.dir, env: repo.env, encoding: "utf8" },
  );
  if (!stdout) throw new Error(stderr);
  return JSON.parse(stdout) as {
    ok?: unknown;
    name?: string;
    message?: string;
  };
}

/** Node is optional when the tests run on Bun. */
const hasNode = nodePath !== undefined;

/** Runtimes that run full TS, not only erasable syntax. */
const fullTs: Runtime[] = [
  ...(hasBun ? (["bun"] as const) : []),
  ...(hasDeno ? (["deno"] as const) : []),
];

const runtimes: Runtime[] = [
  ...(hasNode ? (["node"] as const) : []),
  ...fullTs,
];

describe.each(runtimes)("loadTsConfig on %s", (runtime) => {
  it("returns the default export", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.config.ts",
      `type Hooks = Record<string, string>;
const hooks: Hooks = { "pre-commit": "npm test" };
export default hooks;
`,
    );

    expect(load(repo, runtime)).toEqual({ ok: { "pre-commit": "npm test" } });
  });

  it("loads without a package.json type", () => {
    using repo = createTempRepo();
    repo.write("package.json", "{}");
    repo.write("ward.config.ts", "export default { a: 1 as number };\n");

    expect(load(repo, runtime)).toEqual({ ok: { a: 1 } });
  });

  it("fails without a default export", () => {
    using repo = createTempRepo();
    repo.write("ward.config.ts", "export const config = {};\n");

    expect(load(repo, runtime)).toEqual({
      name: "ConfigError",
      message:
        "ward.config.ts has no default export: use `export default defineConfig({ ... })`",
    });
  });

  it("points at syntax errors", () => {
    using repo = createTempRepo();
    repo.write("ward.config.ts", "export default {\n  a: ,\n};\n");

    const { name, message } = load(repo, runtime);

    expect(name).toBe("ConfigError");
    expect(message).toMatch(/^ward\.config\.ts:2: /);
    expect(message).toContain("\n    a: ,\n       ^");
  });

  it("reports errors thrown by the config", () => {
    using repo = createTempRepo();
    repo.write("ward.config.ts", 'throw new Error("boom");\n');

    expect(load(repo, runtime)).toEqual({
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

    expect(load(repo, runtime).message).toMatch(
      runtime === "deno"
        ? /^ward\.config\.ts: Import "nope-pkg" not a dependency$/
        : /^ward\.config\.ts: Cannot find package 'nope-pkg'/,
    );
  });
});

describe.skipIf(!hasNode)("loadTsConfig on node only", () => {
  it("explains syntax Node can't strip", () => {
    using repo = createTempRepo();
    repo.write("ward.config.ts", "export default {};\nenum A { B }\n");

    const { name, message } = load(repo, "node");

    expect(name).toBe("ConfigError");
    expect(message).toMatch(/^ward\.config\.ts:2: TypeScript enum/);
    expect(message).toContain("Node only strips types");
    expect(message).toContain("\n  enum A { B }\n  ^^^");
  });
});

describe.each(fullTs)("loadTsConfig on %s (full TS)", (runtime) => {
  it("accepts full TS syntax", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.config.ts",
      `enum Mode {
  Fast = "fast",
}
namespace Commands {
  export const test = "npm test";
}
class Task {
  constructor(public run: string) {}
}
const task = new Task(Commands.test);
export default {
  "pre-commit": { tasks: { [Mode.Fast]: { run: task.run } } },
} satisfies Record<string, unknown>;
`,
    );

    expect(load(repo, runtime)).toEqual({
      ok: { "pre-commit": { tasks: { fast: { run: "npm test" } } } },
    });
  });

  it("does not blame type stripping for a syntax error", () => {
    using repo = createTempRepo();
    repo.write("ward.config.ts", "export default {};\nconst a = <div>;\n");

    const { name, message } = load(repo, runtime);

    expect(name).toBe("ConfigError");
    expect(message).toMatch(/^ward\.config\.ts:2: /);
    expect(message).not.toContain("Node only strips types");
    expect(message).toContain("\n  const a = <div>;\n                 ^");
  });
});
