import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HOOKS, type HookName } from "./list.ts";
import {
  CHAINED_SUFFIX,
  isManagedStub,
  renderStub,
  type StubOptions,
} from "./stub.ts";
import { isErrnoCode } from "../util/errors.ts";

export type InstallOptions = StubOptions & {
  /**
   * Move foreign hooks to `<hook>.pre-ward` and run them before ward.
   * Off by default: users may not know a hook is there, so they opt in.
   */
  chain?: boolean;
};

export type ForeignHook = {
  hook: HookName;
  /**
   * Why it was left as is:
   * - `not-chained`: chaining was not requested
   * - `not-a-file`: a directory or other special file, can't be chained
   * - `backup-exists`: `<hook>.pre-ward` is already taken
   */
  reason: "not-chained" | "not-a-file" | "backup-exists";
};

export type InstallResult = {
  /** Stubs created or rewritten (new hook, or an older / edited ward stub). */
  written: HookName[];
  /** Ward stubs that were already up to date. */
  unchanged: HookName[];
  /** Foreign hooks moved to `<hook>.pre-ward`; their stubs are in `written`. */
  chained: HookName[];
  /** Foreign hooks left as is: ward does not run for these hooks. */
  foreign: ForeignHook[];
};

/** Hooks in `hooksDir` that exist and were not written by ward. */
export function findForeignHooks(hooksDir: string): HookName[] {
  return HOOKS.filter(
    (hook) => readExisting(join(hooksDir, hook)).kind === "foreign",
  );
}

/**
 * Write a ward stub for every supported hook into `hooksDir`. Foreign hooks
 * are never overwritten: they are left as is, or chained with `chain: true`.
 */
export function installHooks(
  hooksDir: string,
  { chain = false, ...stubOptions }: InstallOptions = {},
): InstallResult {
  const result: InstallResult = {
    written: [],
    unchanged: [],
    chained: [],
    foreign: [],
  };
  mkdirSync(hooksDir, { recursive: true });

  for (const hook of HOOKS) {
    const file = join(hooksDir, hook);
    const stub = renderStub(hook, stubOptions);
    const current = readExisting(file);

    if (current.kind === "foreign") {
      const reason = foreignReason(file, chain, current.chainable);
      if (reason) {
        result.foreign.push({ hook, reason });
        continue;
      }
      // rename keeps the content, mode and symlinks exactly as they were.
      renameSync(file, file + CHAINED_SUFFIX);
      result.chained.push(hook);
    } else if (current.kind === "ward" && current.content === stub) {
      chmodSync(file, 0o755); // content is right, the exec bit may have been lost
      result.unchanged.push(hook);
      continue;
    }

    writeStub(file, stub);
    result.written.push(hook);
  }

  return result;
}

/** Why a foreign hook must be left as is, or `null` if it can be chained. */
function foreignReason(
  file: string,
  chain: boolean,
  chainable: boolean,
): ForeignHook["reason"] | null {
  if (!chain) return "not-chained";
  if (!chainable) return "not-a-file";
  if (existsSync(file + CHAINED_SUFFIX)) return "backup-exists";
  return null;
}

type Existing =
  | { kind: "missing" }
  | { kind: "foreign"; chainable: boolean }
  | { kind: "ward"; content: string };

function readExisting(file: string): Existing {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) return { kind: "missing" };
    throw error;
  }
  // A symlink is someone else's setup even if it points at a ward stub;
  // it can still be chained (the link itself is moved).
  if (stat.isSymbolicLink()) return { kind: "foreign", chainable: true };
  if (!stat.isFile()) return { kind: "foreign", chainable: false };

  const content = readFileSync(file, "utf8");
  return isManagedStub(content)
    ? { kind: "ward", content }
    : { kind: "foreign", chainable: true };
}

/** Write via a temp file + rename, so git never runs a half-written hook. */
function writeStub(file: string, stub: string) {
  const tmp = `${file}.ward-tmp`;
  writeFileSync(tmp, stub, { mode: 0o755 });
  chmodSync(tmp, 0o755); // `mode` is masked by umask
  renameSync(tmp, file);
}
