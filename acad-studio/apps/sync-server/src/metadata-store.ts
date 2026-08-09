import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { MetadataState, RevisionMetadataStore, TransactionOutcome } from "./types";

function emptyState(): MetadataState {
  return { version: 1, drawings: {} };
}

function parseState(text: string): MetadataState {
  const value = JSON.parse(text) as Partial<MetadataState>;
  if (value.version !== 1 || value.drawings === null || typeof value.drawings !== "object") {
    throw new Error("unsupported or invalid sync metadata file");
  }
  const state = value as MetadataState;
  for (const drawing of Object.values(state.drawings)) {
    if (drawing.objectHashes === undefined) {
      if (drawing.headRevision !== 0) {
        throw new Error("sync metadata predates canonical state verification; recovery snapshot required");
      }
      drawing.objectHashes = {};
    }
  }
  return state;
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class FileRevisionMetadataStore implements RevisionMetadataStore {
  private readonly mutex = new Mutex();
  private state: MetadataState;
  readonly filePath: string;

  private constructor(filePath: string, state: MetadataState) {
    this.filePath = filePath;
    this.state = state;
  }

  static async open(filePath: string): Promise<FileRevisionMetadataStore> {
    let state: MetadataState;
    try {
      state = parseState(await readFile(filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = emptyState();
    }
    return new FileRevisionMetadataStore(filePath, state);
  }

  async transaction<T>(
    operation: (draft: MetadataState) => Promise<TransactionOutcome<T>> | TransactionOutcome<T>,
  ): Promise<T> {
    return this.mutex.run(async () => {
      const draft = structuredClone(this.state);
      const outcome = await operation(draft);
      if (outcome.commit) {
        try {
          await this.persist(draft);
        } catch (error) {
          try {
            this.state = parseState(await readFile(this.filePath, "utf8"));
          } catch {
            // Keep the last known in-memory state when the atomic file was not replaced.
          }
          throw error;
        }
        this.state = draft;
      }
      return outcome.value;
    });
  }

  async read<T>(operation: (state: Readonly<MetadataState>) => T): Promise<T> {
    return this.mutex.run(async () => operation(this.state));
  }

  private async persist(state: MetadataState): Promise<void> {
    const parent = dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporaryPath = join(parent, `.${randomUUID()}.metadata.tmp`);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, this.filePath);
    await fsyncDirectory(parent);
  }
}

export class InMemoryRevisionMetadataStore implements RevisionMetadataStore {
  private readonly mutex = new Mutex();
  private state: MetadataState = emptyState();

  async transaction<T>(
    operation: (draft: MetadataState) => Promise<TransactionOutcome<T>> | TransactionOutcome<T>,
  ): Promise<T> {
    return this.mutex.run(async () => {
      const draft = structuredClone(this.state);
      const outcome = await operation(draft);
      if (outcome.commit) this.state = draft;
      return outcome.value;
    });
  }

  async read<T>(operation: (state: Readonly<MetadataState>) => T): Promise<T> {
    return this.mutex.run(async () => operation(this.state));
  }
}
