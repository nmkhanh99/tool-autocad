/** Browser origins allowed to call the loopback control plane. */
export function allowedBrowserOrigins(port: number): Set<string> {
  const origins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    "http://127.0.0.1:3000",
    "http://localhost:3000",
  ]);
  const configured = process.env.ACAD_WEB_URL || process.env.MEP_WEB_URL;
  if (configured) {
    try {
      origins.add(new URL(configured).origin);
    } catch {
      // Ignore malformed optional configuration rather than widening access.
    }
  }
  return origins;
}

export function isAllowedBrowserOrigin(origin: string | undefined, port: number): boolean {
  // Native clients and local CLI calls do not send Origin.
  return !origin || allowedBrowserOrigins(port).has(origin);
}
