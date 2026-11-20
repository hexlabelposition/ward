import { describe, expect, it } from "vitest";
import { errorAnnotation, isGitHubActions } from "../../src/report/github.ts";

describe("errorAnnotation", () => {
  it("prints a message without properties", () => {
    expect(errorAnnotation("lint failed")).toBe("::error::lint failed");
  });

  it("prints the file, lines and title", () => {
    expect(
      errorAnnotation("fix it", {
        file: "src/a.ts",
        lines: { start: 3, end: 5 },
        title: "ward",
      }),
    ).toBe("::error file=src/a.ts,line=3,endLine=5,title=ward::fix it");
  });

  it("leaves out endLine for one line", () => {
    expect(
      errorAnnotation("x", { file: "a", lines: { start: 7, end: 7 } }),
    ).toBe("::error file=a,line=7::x");
  });

  it("escapes the message and the properties", () => {
    expect(
      errorAnnotation("100%\r\ndone: yes", {
        file: "a,b:c%.txt",
        title: "ward: pre-commit",
      }),
    ).toBe(
      "::error file=a%2Cb%3Ac%25.txt,title=ward%3A pre-commit::100%25%0D%0Adone: yes",
    );
  });
});

describe("isGitHubActions", () => {
  it.each([
    ["true", true],
    ["", false],
    [undefined, false],
    ["1", false],
  ])("GITHUB_ACTIONS=%j → %j", (value, expected) => {
    expect(isGitHubActions({ GITHUB_ACTIONS: value })).toBe(expected);
  });
});
