import { describe, expect, it } from "vitest";
import { expandArgs } from "../../src/runner/command.ts";

describe("expandArgs", () => {
  it("replaces {1}, {2} with hook arguments", () => {
    expect(
      expandArgs("check {1} --source {2}", [".git/COMMIT_EDITMSG", "message"]),
    ).toBe("check .git/COMMIT_EDITMSG --source message");
  });

  it("replaces every occurrence", () => {
    expect(expandArgs("a {1} b {1}", ["x"])).toBe("a x b x");
  });

  it("handles numbers above 9", () => {
    const args = Array.from({ length: 10 }, (_, i) => `a${String(i + 1)}`);

    expect(expandArgs("{10} {1}", args)).toBe("a10 a1");
  });

  it("expands a missing or empty argument to nothing", () => {
    expect(expandArgs("cmd {1} {2}", ["a"])).toBe("cmd a ");
    expect(expandArgs("cmd {1}", [""])).toBe("cmd ");
  });

  it("leaves a command without placeholders as is", () => {
    expect(expandArgs("npm test", ["a"])).toBe("npm test");
  });

  it("leaves {0} and other braces as is", () => {
    expect(expandArgs("echo {0} {a} {} ${1} {staged_files}", ["x"])).toBe(
      "echo {0} {a} {} $x {staged_files}",
    );
  });

  it("does not expand placeholders inside a value", () => {
    expect(expandArgs("{1}", ["{2}", "x"], "linux")).toBe("'{2}'");
  });

  it("quotes values for sh", () => {
    expect(expandArgs("cat {1}", ["my repo/.git/MSG"], "linux")).toBe(
      "cat 'my repo/.git/MSG'",
    );
    expect(expandArgs("cat {1}", ["it's; rm -rf $HOME"], "linux")).toBe(
      "cat 'it'\\''s; rm -rf $HOME'",
    );
    expect(expandArgs("cat {1}", ["a\\b"], "linux")).toBe("cat 'a\\b'");
  });

  it("quotes values for cmd.exe", () => {
    expect(expandArgs("type {1}", ["C:\\repo\\.git\\MSG"], "win32")).toBe(
      "type C:\\repo\\.git\\MSG",
    );
    expect(expandArgs("type {1}", ["C:\\my repo\\MSG"], "win32")).toBe(
      'type "C:\\my repo\\MSG"',
    );
    expect(expandArgs("echo {1}", ['a "b" & c'], "win32")).toBe(
      'echo "a \\"b\\" & c"',
    );
  });
});
