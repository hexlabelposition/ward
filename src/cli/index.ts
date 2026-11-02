#!/usr/bin/env node
import { parseArgs } from "node:util";

// Commands are imported lazily to keep startup fast (W49).
async function main(argv: string[]): Promise<number> {
  if (argv[0] === "run") {
    // Hook args from git are passed through as is, so they are not parsed here.
    // No config loading yet (W11-W15), so no hook has tasks: exit 0 instead of
    // blocking git with "unknown command" right after install.
    return 0;
  }

  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      chain: { type: "boolean" },
    },
  });
  const [command] = positionals;

  if (command === undefined) {
    const { install } = await import("./install.ts");
    return install({ chain: values.chain ?? false });
  }

  console.error(`ward: unknown command "${command}"`);
  return 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(
    `ward: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
