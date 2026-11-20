import { describe, expect, it } from "vitest";
import { detectRuntime } from "../../src/runtime/detect.ts";

function versions(extra: Record<string, string>): NodeJS.ProcessVersions {
  return { ...process.versions, ...extra };
}

describe("detectRuntime", () => {
  it("returns node without process.versions.bun", () => {
    const node = versions({ node: "24.3.0" });
    delete node.bun;
    expect(detectRuntime(node)).toBe("node");
  });

  it("returns bun when process.versions.bun is set, even next to a node version", () => {
    expect(detectRuntime(versions({ node: "24.3.0", bun: "1.3.0" }))).toBe(
      "bun",
    );
  });

  it("detects the current runtime by default", () => {
    expect(detectRuntime()).toBe(
      process.versions.bun === undefined ? "node" : "bun",
    );
  });
});
