/** Dò một binary trên PATH (thay cho gói `which`). Trả path tuyệt đối hoặc null. */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export default function which(bin: string): string | null {
  const paths = (process.env.PATH ?? "").split(":").filter(Boolean);
  // Thêm vài nơi CLI hay cài mà GUI/Electron dễ thiếu trong PATH.
  const extra = [
    join(process.env.HOME ?? "", ".local/bin"),
    join(process.env.HOME ?? "", ".grok/bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  for (const dir of [...paths, ...extra]) {
    const p = join(dir, bin);
    try {
      if (existsSync(p) && statSync(p).isFile()) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}
