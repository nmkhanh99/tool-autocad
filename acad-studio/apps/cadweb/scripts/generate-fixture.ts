import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createDeterministicFixture } from "../src/fixture";

const fixtureUrl = new URL("../test/fixtures/basic-v1.cadweb", import.meta.url);
await mkdir(fileURLToPath(new URL(".", fixtureUrl)), { recursive: true });
await writeFile(fixtureUrl, await createDeterministicFixture());
console.log(fileURLToPath(fixtureUrl));
