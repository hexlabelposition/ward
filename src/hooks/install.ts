import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HOOKS, type HookName } from "./list.ts";
import { isManagedStub, renderStub, type StubOptions } from "./stub.ts";

export type InstallResult = {
  /** Stubs created or rewritten (new hook, or an older / edited ward stub). */
  written: HookName[];
  /** Ward stubs that were already up to date. */
  unchanged: HookName[];
  /** Existing hooks not written by ward, left as is (backup + chaining is W40). */
  foreign: HookName[];
};

/** Write a ward stub for every supported hook into `hooksDir`. Never touches foreign hooks. */
export function installHooks(
  hooksDir: string,
  stubOptions: StubOptions = {},
): InstallResult {
  const result: InstallResult = { written: [], unchanged: [], foreign: [] };
  mkdirSync(hooksDir, { recursive: true });

  for (const hook of HOOKS) {
    const file = join(hooksDir, hook);
    const stub = renderStub(hook, stubOptions);
    const current = readExisting(file);

    if (current.kind === "foreign") {
      result.foreign.push(hook);
    } else if (current.kind === "ward" && current.content === stub) {
      chmodSync(file, 0o755); // content is right, the exec bit may have been lost
      result.unchanged.push(hook);
    } else {
      writeStub(file, stub);
      result.written.push(hook);
    }
  }

  return result;
}

type Existing =
  { kind: "missing" } | { kind: "foreign" } | { kind: "ward"; content: string };

function readExisting(file: string): Existing {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) return { kind: "missing" };
    throw error;
  }
  // Symlinks and directories are someone else's setup.
  if (!stat.isFile()) return { kind: "foreign" };

  const content = readFileSync(file, "utf8");
  return isManagedStub(content)
    ? { kind: "ward", content }
    : { kind: "foreign" };
}

/** Write via a temp file + rename, so git never runs a half-written hook. */
function writeStub(file: string, stub: string) {
  const tmp = `${file}.ward-tmp`;
  writeFileSync(tmp, stub, { mode: 0o755 });
  chmodSync(tmp, 0o755); // `mode` is masked by umask
  renameSync(tmp, file);
}

function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
