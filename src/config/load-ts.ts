import { basename } from "node:path";
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

/**
 * Node puts the line of a syntax error in the stack, not the message:
 * `/path/ward.config.ts:3`, then a few source lines with a `^^^` marker,
 * then an empty line.
 */
function syntaxLocation(
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
