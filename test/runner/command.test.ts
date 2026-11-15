import { describe, expect, it } from "vitest";
import { expandCommand, fileSources } from "../../src/runner/command.ts";

describe("expandCommand", () => {
  it("replaces {1}, {2} with hook arguments", () => {
    expect(
      expandCommand("check {1} --source {2}", {
        args: [".git/COMMIT_EDITMSG", "message"],
      }),
    ).toBe("check .git/COMMIT_EDITMSG --source message");
  });

  it("replaces every occurrence", () => {
    expect(expandCommand("a {1} b {1}", { args: ["x"] })).toBe("a x b x");
  });

  it("handles numbers above 9", () => {
    const args = Array.from({ length: 10 }, (_, i) => `a${String(i + 1)}`);

    expect(expandCommand("{10} {1}", { args: args })).toBe("a10 a1");
  });

  it("expands a missing or empty argument to nothing", () => {
    expect(expandCommand("cmd {1} {2}", { args: ["a"] })).toBe("cmd a ");
    expect(expandCommand("cmd {1}", { args: [""] })).toBe("cmd ");
  });

  it("leaves a command without placeholders as is", () => {
    expect(expandCommand("npm test", { args: ["a"] })).toBe("npm test");
  });

  it("leaves {0} and other braces as is", () => {
    expect(expandCommand("echo {0} {a} {} ${1} {files}", { args: ["x"] })).toBe(
      "echo {0} {a} {} $x {files}",
    );
  });

  it("does not expand placeholders inside a value", () => {
    expect(expandCommand("{1}", { args: ["{2}", "x"] }, "linux")).toBe("'{2}'");
  });

  it("quotes values for sh", () => {
    expect(
      expandCommand("cat {1}", { args: ["my repo/.git/MSG"] }, "linux"),
    ).toBe("cat 'my repo/.git/MSG'");
    expect(
      expandCommand("cat {1}", { args: ["it's; rm -rf $HOME"] }, "linux"),
    ).toBe("cat 'it'\\''s; rm -rf $HOME'");
    expect(expandCommand("cat {1}", { args: ["a\\b"] }, "linux")).toBe(
      "cat 'a\\b'",
    );
  });

  it("quotes values for cmd.exe", () => {
    expect(
      expandCommand("type {1}", { args: ["C:\\repo\\.git\\MSG"] }, "win32"),
    ).toBe("type C:\\repo\\.git\\MSG");
    expect(
      expandCommand("type {1}", { args: ["C:\\my repo\\MSG"] }, "win32"),
    ).toBe('type "C:\\my repo\\MSG"');
    expect(expandCommand("echo {1}", { args: ['a "b" & c'] }, "win32")).toBe(
      'echo "a \\"b\\" & c"',
    );
  });
});

describe("expandCommand with files", () => {
  it("expands each file placeholder to its files", () => {
    expect(
      expandCommand(
        "lint {staged_files} && push {push_files} && all {all_files}",
        {
          files: {
            staged: ["a.ts", "b.ts"],
            push: ["c.ts"],
            all: ["a.ts", "b.ts", "c.ts"],
          },
        },
        "linux",
      ),
    ).toBe("lint a.ts b.ts && push c.ts && all a.ts b.ts c.ts");
  });

  it("expands a missing source or no files to nothing", () => {
    expect(
      expandCommand("x {staged_files} {all_files}", { files: { all: [] } }),
    ).toBe("x  ");
  });

  it("quotes each file", () => {
    expect(
      expandCommand(
        "x {staged_files}",
        { files: { staged: ["my file.ts", "it's.ts", "ok.ts"] } },
        "linux",
      ),
    ).toBe("x 'my file.ts' 'it'\\''s.ts' ok.ts");
    expect(
      expandCommand(
        "x {staged_files}",
        { files: { staged: ["my file.ts", "ok.ts"] } },
        "win32",
      ),
    ).toBe('x "my file.ts" ok.ts');
  });

  it("does not expand placeholders inside file names", () => {
    expect(
      expandCommand(
        "x {staged_files} {1}",
        { args: ["arg"], files: { staged: ["{1}.ts", "{all_files}"] } },
        "linux",
      ),
    ).toBe("x '{1}.ts' '{all_files}' arg");
  });
});

describe("fileSources", () => {
  it("lists the file sources a command uses", () => {
    expect(fileSources("eslint {staged_files} {staged_files} {1}")).toEqual(
      new Set(["staged"]),
    );
    expect(fileSources("a {push_files} b {all_files}")).toEqual(
      new Set(["push", "all"]),
    );
    expect(fileSources("npm test {files}")).toEqual(new Set());
  });
});
