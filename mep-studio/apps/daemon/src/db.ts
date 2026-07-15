/** Lưu lịch sử chat bằng SQLite qua sql.js (bản WASM, thuần JS) — chạy trên mọi
 * Node/Electron, không cần build native. DB ghi ra file .sqlite trong app-data.
 * DB: ~/Library/Application Support/mep-studio/mep.sqlite (đổi bằng MEP_DATA_DIR).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";

function dataDir(): string {
  if (process.env.MEP_DATA_DIR) return process.env.MEP_DATA_DIR;
  return join(homedir(), "Library", "Application Support", "mep-studio");
}

export interface Store {
  ensureConversation(id: string, agent: string, firstUserMsg: string): void;
  addMessage(convId: string, role: "user" | "assistant", content: string): void;
  listConversations(): any[];
  getMessages(convId: string): any[];
}

export async function initDb(): Promise<Store> {
  const wasmPath = process.env.MEP_SQLJS_WASM;
  if (!wasmPath || !existsSync(wasmPath))
    throw new Error(`Không thấy sql-wasm.wasm (đặt MEP_SQLJS_WASM). Hiện: ${wasmPath}`);
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "mep.sqlite");
  const db = existsSync(file) ? new SQL.Database(readFileSync(file)) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, agent TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);

  const save = () => writeFileSync(file, Buffer.from(db.export()));

  const all = (sql: string, params: any[] = []): any[] => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  return {
    ensureConversation(id, agent, firstUserMsg) {
      const now = Date.now();
      db.run("INSERT OR IGNORE INTO conversations (id, agent, title, created_at) VALUES (?,?,?,?)",
        [id, agent, "", now]);
      db.run("UPDATE conversations SET title = ? WHERE id = ? AND title = ''",
        [firstUserMsg.slice(0, 60), id]);
      save();
    },
    addMessage(convId, role, content) {
      db.run("INSERT INTO messages (conv_id, role, content, created_at) VALUES (?,?,?,?)",
        [convId, role, content, Date.now()]);
      save();
    },
    listConversations() {
      return all("SELECT id, agent, title, created_at FROM conversations ORDER BY created_at DESC LIMIT 100");
    },
    getMessages(convId) {
      return all("SELECT role, content, created_at FROM messages WHERE conv_id = ? ORDER BY id ASC", [convId]);
    },
  };
}
