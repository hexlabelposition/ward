import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadYamlConfig } from "../../src/config/load-yml.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

describe("loadYamlConfig", () => {
  it("returns the config as plain data", () => {
    using repo = createTempRepo();
    repo.write(
      "ward.yml",
      `pre-commit:
  parallel: true
  tasks:
    lint:
      run: eslint {staged_files}
      glob: "*.ts"
commit-msg: node check.js {1}
`,
    );

    expect(loadYamlConfig(join(repo.dir, "ward.yml"))).toEqual({
      "pre-commit": {
        parallel: true,
        tasks: { lint: { run: "eslint {staged_files}", glob: "*.ts" } },
      },
      "commit-msg": "node check.js {1}",
    });
  });

  it.each(["", "# nothing yet\n"])("treats %j as an empty config", (text) => {
    using repo = createTempRepo();
    repo.write("ward.yaml", text);

    expect(loadYamlConfig(join(repo.dir, "ward.yaml"))).toEqual({});
  });

  it("points at syntax errors", () => {
    using repo = createTempRepo();
    // An unquoted colon in a command, a common mistake.
    repo.write("ward.yml", "pre-commit: npm test\ncommit-msg: a: b\n");

    expect(() => loadYamlConfig(join(repo.dir, "ward.yml"))).toThrow(
      /^ward\.yml: Nested mappings .* at line 2, column 13:\n\ncommit-msg: a: b\n/,
    );
  });

  it("fails on duplicate keys", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "pre-commit: a\npre-commit: b\n");

    expect(() => loadYamlConfig(join(repo.dir, "ward.yml"))).toThrow(
      /^ward\.yml: Map keys must be unique/,
    );
  });

  it("fails on several documents", () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "pre-commit: a\n---\ncommit-msg: b\n");

    expect(() => loadYamlConfig(join(repo.dir, "ward.yml"))).toThrow(
      /^ward\.yml: /,
    );
  });
});
