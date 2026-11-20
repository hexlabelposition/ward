import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError } from "./errors.ts";

/**
 * Default export of `ward.config.ts`, not validated yet. Native `import()`:
 * Node strips types (erasable syntax only), Bun and Deno run full TS.
 *
 * Each `ward run` is a fresh process, so the module cache never serves an
 * outdated config.
 */
export async function loadTsConfig(file: string): Promise<unknown> {
  const name = basename(file);
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (error) {
    const where = syntaxLocation(error, file);
    const message = `${name}${where ? `:${where.line}` : ""}: ${describe(error)}`;
    throw new ConfigError(where ? `${message}\n${where.frame}` : message, {
      cause: error,
    });
  }

  if (!Object.hasOwn(mod, "default")) {
    throw new ConfigError(
      `${name} has no default export: use \`export default defineConfig({ ... })\``,
    );
  }
  return mod.default;
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const message = error.message.split("\n")[0] ?? "";
  if ("code" in error && error.code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX") {
    return (
      `${message}. Node only strips types: replace enum, namespace and ` +
      "parameter properties with plain JS, or use ward.yml"
    );
  }
  return message;
}

function syntaxLocation(
  error: unknown,
  file: string,
): { line: string; frame: string } | null {
  return nodeSyntaxLocation(error, file) ?? bunSyntaxLocation(error, file);
}

/**
 * Node puts the line of a syntax error in the stack, not the message:
 * `/path/ward.config.ts:3`, then a few source lines with a `^^^` marker,
 * then an empty line.
 */
function nodeSyntaxLocation(
  error: unknown,
  file: string,
): { line: string; frame: string } | null {
  if (!(error instanceof SyntaxError) || !error.stack) return null;
  const [first = "", ...rest] = error.stack.split("\n");
  const match = /^(.*):(\d+)$/.exec(first);
  if (!match?.[2] || match[1] !== file) return null;
  const end = rest.indexOf("");
  const frame = rest.slice(0, end === -1 ? 0 : Math.min(end, 8));
  if (frame.length === 0) return null;
  return {
    line: match[2],
    frame: frame.map((line) => `  ${line}`.trimEnd()).join("\n"),
  };
}

/**
 * Bun throws a `BuildMessage` (not a `SyntaxError`) with no stack: the
 * location is in `position`, with a 1-based line and column.
 */
function bunSyntaxLocation(
  error: unknown,
  file: string,
): { line: string; frame: string } | null {
  if (!(error instanceof Error) || error.name !== "BuildMessage") return null;
  const { position } = error as { position?: unknown };
  if (typeof position !== "object" || position === null) return null;
  const {
    file: at,
    line,
    column,
    lineText,
  } = position as Record<string, unknown>;
  if (
    typeof at !== "string" ||
    resolve(at) !== resolve(file) ||
    typeof line !== "number" ||
    typeof lineText !== "string"
  ) {
    return null;
  }
  const frame = [`  ${lineText}`.trimEnd()];
  if (typeof column === "number" && column >= 1) {
    frame.push(`  ${" ".repeat(column - 1)}^`);
  }
  return { line: String(line), frame: frame.join("\n") };
}
