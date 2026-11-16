import { describe, expect, it } from "vitest";
import {
  colorEnv,
  prefixLines,
  taskPrefixes,
} from "../../src/runner/output.ts";

function collect(prefix = "> ") {
  const written: string[] = [];
  const lines = prefixLines(prefix, (text) => written.push(text));
  return { lines, written };
}

describe("prefixLines", () => {
  it("writes whole lines only, each after the prefix", () => {
    const { lines, written } = collect();
    lines.write("a\nb");
    lines.write("c\n\nd\n");

    expect(written).toEqual(["> a\n", "> bc\n> \n> d\n"]);
  });

  it("writes a last line without a newline on end", () => {
    const { lines, written } = collect();
    lines.write("a\nrest");
    lines.end();
    lines.end();

    expect(written).toEqual(["> a\n", "> rest\n"]);
  });

  it("keeps a character split between chunks whole", () => {
    const { lines, written } = collect();
    const bytes = Buffer.from("ж\n");
    lines.write(bytes.subarray(0, 1));
    lines.write(bytes.subarray(1));

    expect(written).toEqual(["> ж\n"]);
  });

  it("keeps \\r inside lines", () => {
    const { lines, written } = collect();
    lines.write("a\r\n");

    expect(written).toEqual(["> a\r\n"]);
  });
});

describe("taskPrefixes", () => {
  it("pads names to the longest one", () => {
    // Not a terminal under vitest, so no colors.
    expect(taskPrefixes(["lint", "typecheck"], 0)).toEqual({
      stdout: "lint      | ",
      stderr: "lint      | ",
    });
    expect(taskPrefixes(["lint", "typecheck"], 1).stdout).toBe("typecheck | ");
  });
});

describe("colorEnv", () => {
  it("leaves the env as is when output is not a terminal", () => {
    const env = { PATH: "/bin" };
    expect(colorEnv(env)).toBe(env);
  });

  it("keeps FORCE_COLOR and NO_COLOR set by the user", () => {
    const env = { NO_COLOR: "1" };
    expect(colorEnv(env)).toBe(env);
  });
});
