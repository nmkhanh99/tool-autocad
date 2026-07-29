import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined),
);

Object.assign(env, {
  ACAD_DAEMON_URL: "http://127.0.0.1:1",
  ACAD_MCP_AUTOSTART_DAEMON: "0",
});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", serverEntry],
  cwd: packageRoot,
  env,
  stderr: "pipe",
});
const client = new Client({
  name: "acad-mcp-protocol-test",
  version: "0.1.0",
});
let connected = false;
let serverStderr = "";

transport.stderr?.on("data", (chunk) => {
  serverStderr += chunk.toString();
});

try {
  await client.connect(transport);
  connected = true;

  const { tools } = await client.listTools();
  const expectedNames = [
    "annotation",
    "block",
    "drawing",
    "entity",
    "layer",
    "pid",
    "system",
    "view",
  ];

  assert.equal(tools.length, expectedNames.length);
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    expectedNames,
  );

  for (const tool of tools) {
    assert.ok(tool.inputSchema.required?.includes("operation"));
    assert.ok("target" in (tool.inputSchema.properties ?? {}));
  }

  const systemTool = tools.find((tool) => tool.name === "system");
  assert.equal(systemTool?.annotations?.readOnlyHint, false);
  const viewTool = tools.find((tool) => tool.name === "view");
  assert.equal(viewTool?.annotations?.readOnlyHint, false);
  const entityTool = tools.find((tool) => tool.name === "entity");
  assert.ok("side_point" in (entityTool?.inputSchema.properties ?? {}));
  assert.ok("row_dist" in (entityTool?.inputSchema.properties ?? {}));

  const runtimeResult = await client.callTool({
    name: "system",
    arguments: { operation: "runtime" },
  });
  const text = runtimeResult.content.find((content) => content.type === "text");

  assert.equal(runtimeResult.isError, false);
  assert.ok(text && text.type === "text");
  assert.equal(JSON.parse(text.text).ok, true);

  console.log("MCP protocol test passed: 8 tools listed; system(runtime) ok.");
} catch (error) {
  if (serverStderr) {
    console.error(serverStderr);
  }
  throw error;
} finally {
  if (connected) {
    await client.close();
  } else {
    await transport.close();
  }
}
