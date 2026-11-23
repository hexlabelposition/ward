// Writes the JSON Schemas editors use for `ward.yml`, `ward.local.yml` and
// `package.json`. Run with `bun run schema` after changing hooks or options.
import { writeFileSync } from "node:fs";
import {
  buildConfigSchema,
  buildPackageSchema,
} from "../src/config/json-schema.ts";

const write = (file: string, schema: unknown) => {
  writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
};

write("schema.json", buildConfigSchema());
write("local.schema.json", buildConfigSchema({ local: true }));
write("package.schema.json", buildPackageSchema());
