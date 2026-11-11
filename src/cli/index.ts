#!/usr/bin/env node
import { parseArgs } from "node:util";

// Commands are imported lazily to keep startup fast (W49).
async function main(argv: string[]): Promise<number> {
  if (argv[0] === "run") {
    // Hook args from git are passed through as is, so they are not parsed here.
    const [hook, ...args] = argv.slice(1);
    const { run } = await import("./run.ts");
    return run({ hook, args });
  }

  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      chain: { type: "boolean" },
      force: { type: "boolean" },
      "respect-hooks-path": { type: "boolean" },
    },
  });
  const [command] = positionals;

  if (command === undefined) {
    const { install } = await import("./install.ts");
    return install({
      chain: values.chain ?? false,
      respectHooksPath: values["respect-hooks-path"] ?? false,
      force: values.force ?? false,
    });
  }

  if (command === "uninstall") {
    // The options above are install flags.
    const extra = [
      ...positionals.slice(1),
      ...Object.keys(values).map((k) => `--${k}`),
    ];
    if (extra.length > 0) {
      console.error(
        `ward uninstall: unexpected argument "${String(extra[0])}"`,
      );
      return 1;
    }
    const { uninstall } = await import("./uninstall.ts");
    return uninstall();
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
