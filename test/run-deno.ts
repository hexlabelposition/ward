/**
 * Runs vitest on Deno (`bun run test:deno`).
 *
 * After the tests, while vitest closes its forked workers, Deno's
 * `node:child_process` can throw "IPC channel is already disconnected" from
 * its own read loop, which fails the run even though every test passed. Seen
 * on Windows runners since the suite got longer. This drops that one error,
 * so the exit code is vitest's own; any other error still fails the run.
 * Remove it once Deno no longer throws there.
 */
const DENO_IPC_ERROR = "IPC channel is already disconnected";

function onError(error: unknown): void {
  if (error instanceof Error && error.message === DENO_IPC_ERROR) return;
  console.error(error);
  process.exit(1);
}

process.on("uncaughtException", onError);
process.on("unhandledRejection", onError);

// vitest's CLI entry has no types: import it by URL.
await import(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url).href
);
