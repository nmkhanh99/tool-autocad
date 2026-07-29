import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createAcadMcpServer } from "./server.js";

serveStdio(() => createAcadMcpServer(), {
  onerror(error) {
    console.error(error);
  },
});
