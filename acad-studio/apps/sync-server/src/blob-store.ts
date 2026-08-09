import { constants } from "node:fs";
import { access, link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { sha256 } from "./crypto";
import type { ImmutableBlobStore } from "./types";

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class ImmutableFileBlobStore implements ImmutableBlobStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private pathFor(hash: string): string {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("invalid blob SHA-256");
    return join(this.root, "sha256", hash.slice(0, 2), hash);
  }

  async put(bytes: Uint8Array, expectedHash: string): Promise<{ hash: string; size: number }> {
    const actualHash = sha256(bytes);
    if (actualHash !== expectedHash) throw new Error("blob SHA-256 changed before storage");

    const finalPath = this.pathFor(actualHash);
    const parent = dirname(finalPath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporaryPath = join(parent, `.${actualHash}.${process.pid}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(temporaryPath, finalPath);
      await fsyncDirectory(parent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(finalPath);
      if (existing.byteLength !== bytes.byteLength || sha256(existing) !== actualHash) {
        throw new Error(`immutable blob collision at ${actualHash}`);
      }
    } finally {
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return { hash: actualHash, size: bytes.byteLength };
  }

  async get(hash: string): Promise<Uint8Array> {
    const bytes = await readFile(this.pathFor(hash));
    if (sha256(bytes) !== hash) throw new Error(`stored blob ${hash} failed integrity validation`);
    return bytes;
  }

  async has(hash: string): Promise<boolean> {
    try {
      await access(this.pathFor(hash), constants.R_OK);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}
