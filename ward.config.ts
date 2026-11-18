// This repo's own hooks: `prepare` builds dist/ and installs stubs that call
// dist/cli.mjs (see CONTRIBUTING.md). defineConfig comes from src/, so the
// config type-checks before dist/ is built.
import { defineConfig } from "./src/index.ts";

export default defineConfig({
  hooks: {
    "pre-commit": {
      // In order: Prettier formats what ESLint fixed.
      tasks: {
        eslint: {
          run: "npx --no --loglevel=warn -- eslint --fix --no-warn-ignored {staged_files}",
          glob: "*.{ts,mts,cts,js,mjs,cjs}",
        },
        prettier: {
          run: "npx --no --loglevel=warn -- prettier --write --ignore-unknown {staged_files}",
        },
      },
    },
  },
});
