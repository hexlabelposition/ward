import { describe, expect, it } from "vitest";
import { HOOKS, isHookName } from "../../src/hooks/list.ts";

describe("HOOKS", () => {
  it("has no duplicates", () => {
    expect(new Set(HOOKS).size).toBe(HOOKS.length);
  });

  it("includes the common client hooks", () => {
    expect(HOOKS).toEqual(
      expect.arrayContaining(["pre-commit", "commit-msg", "pre-push"]),
    );
  });

  it.each([
    "reference-transaction",
    "post-index-change",
    "fsmonitor-watchman",
    "pre-receive",
    "update",
    "p4-pre-submit",
  ])("leaves out %s", (name) => {
    expect(isHookName(name)).toBe(false);
  });
});

describe("isHookName", () => {
  it("accepts known hooks", () => {
    expect(isHookName("pre-commit")).toBe(true);
  });

  it.each(["", "precommit", "Pre-Commit", "pre-commit.sample", "toString"])(
    "rejects %j",
    (name) => {
      expect(isHookName(name)).toBe(false);
    },
  );
});
