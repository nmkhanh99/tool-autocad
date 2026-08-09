import { join } from "node:path";

import { ImmutableFileBlobStore } from "./blob-store";
import { CadWebArtifactValidator } from "./cadweb-validator";
import { FileRevisionMetadataStore } from "./metadata-store";
import { SyncRevisionService } from "./service";
import type { Authorizer, RevisionEventPublisher } from "./types";

interface FileBackedServiceOptions {
  dataDirectory: string;
  authorizer: Authorizer;
  publisher: RevisionEventPublisher;
  clock?: () => Date;
  idGenerator?: () => string;
  maxArtifactBytes?: number;
  recoverUnpublishedEvents?: boolean;
}

export async function createFileBackedSyncService(
  options: FileBackedServiceOptions,
): Promise<SyncRevisionService> {
  const metadata = await FileRevisionMetadataStore.open(join(options.dataDirectory, "metadata.json"));
  const blobs = new ImmutableFileBlobStore(join(options.dataDirectory, "blobs"));
  const service = new SyncRevisionService({
    authorizer: options.authorizer,
    publisher: options.publisher,
    validator: new CadWebArtifactValidator(),
    metadata,
    blobs,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.idGenerator === undefined ? {} : { idGenerator: options.idGenerator }),
    ...(options.maxArtifactBytes === undefined
      ? {}
      : { maxArtifactBytes: options.maxArtifactBytes }),
  });
  if (options.recoverUnpublishedEvents !== false) {
    await service.recoverUnpublishedEvents();
  }
  return service;
}
