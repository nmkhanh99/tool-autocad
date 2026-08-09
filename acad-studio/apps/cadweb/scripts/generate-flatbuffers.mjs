import { spawnSync } from "node:child_process";
import { copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const expectedVersion = "flatc version 25.9.23";
const compiler = process.env.CADWEB_FLATC ?? "flatc";
const geometrySchema = fileURLToPath(
  new URL("../../../../cad-platform/schema/geometry.fbs", import.meta.url),
);
const manifestSchema = fileURLToPath(
  new URL("../../../../cad-platform/schema/manifest.schema.json", import.meta.url),
);
const output = fileURLToPath(new URL("../src/generated", import.meta.url));

const version = spawnSync(compiler, ["--version"], { encoding: "utf8" });
if (version.status !== 0 || version.stdout.trim() !== expectedVersion) {
  throw new Error(`CADWEB_FLATC must point to ${expectedVersion}`);
}

await rm(output, { recursive: true, force: true });
const generated = spawnSync(
  compiler,
  ["--ts", "--gen-object-api", "-o", output, geometrySchema],
  { stdio: "inherit" },
);
if (generated.status !== 0) {
  throw new Error(`flatc exited with status ${generated.status ?? "unknown"}`);
}

async function removeJsSpecifiers(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await removeJsSpecifiers(path);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const source = await readFile(path, "utf8");
      const compatible = source.replace(/((?:\.\.?\/)[^'"\n]+)\.js(?=['"])/g, "$1");
      if (compatible !== source) await writeFile(path, compatible);
    }
  }
}

await removeJsSpecifiers(output);
await copyFile(manifestSchema, `${output}/manifest.schema.json`);
