import { describe, expect, it } from "vitest";
import {
  checkGlob,
  createMatcher,
  matchFiles,
} from "../../src/runner/match.ts";

const files = [
  "README.md",
  "src/index.ts",
  "src/lib/util.ts",
  "src/lib/util.test.ts",
  "docs/guide.md",
  ".github/workflows/ci.yml",
  ".prettierrc",
  "dist/index.js",
];

describe("matchFiles", () => {
  it("keeps every file without glob or exclude", () => {
    expect(matchFiles(files, {})).toEqual(files);
  });

  it("matches a pattern without `/` against the file name anywhere", () => {
    expect(matchFiles(files, { glob: ["*.ts"] })).toEqual([
      "src/index.ts",
      "src/lib/util.ts",
      "src/lib/util.test.ts",
    ]);
  });

  it("matches a pattern with `/` against the path from the root", () => {
    expect(matchFiles(files, { glob: ["src/*.ts"] })).toEqual(["src/index.ts"]);
    expect(matchFiles(files, { glob: ["src/**/*.ts"] })).toEqual([
      "src/index.ts",
      "src/lib/util.ts",
      "src/lib/util.test.ts",
    ]);
  });

  it("keeps a file that matches any of the patterns", () => {
    expect(matchFiles(files, { glob: ["*.md", "*.yml"] })).toEqual([
      "README.md",
      "docs/guide.md",
      ".github/workflows/ci.yml",
    ]);
  });

  it("supports braces", () => {
    expect(matchFiles(files, { glob: ["*.{md,js}"] })).toEqual([
      "README.md",
      "docs/guide.md",
      "dist/index.js",
    ]);
  });

  it("matches dotfiles and files in dot directories", () => {
    expect(matchFiles(files, { glob: [".*"] })).toEqual([".prettierrc"]);
    expect(matchFiles(files, { glob: ["**/*.yml"] })).toEqual([
      ".github/workflows/ci.yml",
    ]);
  });

  it("drops excluded files, also without glob", () => {
    expect(
      matchFiles(files, { glob: ["*.ts"], exclude: ["*.test.ts"] }),
    ).toEqual(["src/index.ts", "src/lib/util.ts"]);
    expect(
      matchFiles(files, { exclude: ["dist/**", ".*", "**/.*/**"] }),
    ).toEqual([
      "README.md",
      "src/index.ts",
      "src/lib/util.ts",
      "src/lib/util.test.ts",
      "docs/guide.md",
    ]);
  });

  it("keeps non-ASCII names and spaces", () => {
    expect(
      matchFiles(["docs/мой файл.md", "a.txt"], { glob: ["*.md"] }),
    ).toEqual(["docs/мой файл.md"]);
  });

  it("escapes special characters with a backslash", () => {
    expect(
      matchFiles(["app/[id]/page.tsx", "app/x/page.tsx"], {
        glob: ["app/\\[id\\]/*.tsx"],
      }),
    ).toEqual(["app/[id]/page.tsx"]);
  });
});

describe("createMatcher", () => {
  it("throws on an invalid pattern", () => {
    expect(() => createMatcher({ glob: ["{a,b"] })).toThrow();
  });
});

describe("checkGlob", () => {
  it("accepts valid patterns", () => {
    for (const pattern of ["*.ts", "src/**", "*.{ts,tsx}", "!(*.d).ts"]) {
      expect(checkGlob(pattern)).toBeNull();
    }
  });

  it("rejects empty patterns", () => {
    expect(checkGlob("")).toBe("pattern is empty");
    expect(checkGlob("  ")).toBe("pattern is empty");
  });

  it("rejects unbalanced brackets, braces and parens", () => {
    expect(checkGlob("[abc")).toMatch(/\]/);
    expect(checkGlob("*.{ts")).toMatch(/\}/);
    expect(checkGlob("a)")).toMatch(/\(/);
  });

  it("rejects paths not relative to the repo root", () => {
    expect(checkGlob("./src/*.ts")).toBe(
      'patterns are relative to the repo root: write "src/*.ts"',
    );
    expect(checkGlob("/src/*.ts")).toBe(
      'patterns are relative to the repo root: write "src/*.ts"',
    );
  });
});
