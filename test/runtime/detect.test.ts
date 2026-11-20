import { describe, expect, it } from "vitest";
import { detectRuntime } from "../../src/runtime/detect.ts";

function versions(extra: Record<string, string>): NodeJS.ProcessVersions {
  return { ...process.versions, ...extra };
}

describe("detectRuntime", () => {
  it("returns node without process.versions.bun and .deno", () => {
    const node = versions({ node: "24.3.0" });
    delete node.bun;
    delete node.deno;
    expect(detectRuntime(node)).toBe("node");
  });

  it("returns bun when process.versions.bun is set, even next to a node version", () => {
    expect(detectRuntime(versions({ node: "24.3.0", bun: "1.3.0" }))).toBe(
      "bun",
    );
  });

  it("returns deno when process.versions.deno is set, even next to a node version", () => {
    expect(detectRuntime(versions({ node: "24.3.0", deno: "2.5.0" }))).toBe(
      "deno",
    );
  });

  it("detects the current runtime by default", () => {
    const expected =
      process.versions.bun !== undefined
        ? "bun"
        : process.versions.deno !== undefined
          ? "deno"
          : "node";
    expect(detectRuntime()).toBe(expected);
  });
});
