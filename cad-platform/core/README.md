# CadWeb C++ core

This C++17 library owns the shared CadWeb DTO, writers, and Save Sync state.
It has no ObjectARX or Cocoa dependency; the durable store uses small
Windows/POSIX adapters only for flush and atomic-replace semantics. AutoCAD
adapters convert their native objects into `cadweb::CadDocument`, then call
`cadweb::CadWebWriter`.

The writer validates the DTO, sorts stable identifiers, serializes the
FlatBuffers geometry contract, creates payload checksums, and returns a
deterministic ZIP-store archive. Before allocating the ZIP envelope, it applies
the same limits as the canonical TypeScript reader:

| Limit | Maximum |
| --- | ---: |
| Archive bytes | 256 MiB |
| Entries | 128 |
| One uncompressed entry | 128 MiB |
| Total uncompressed bytes | 256 MiB |
| `manifest.json` | 1 MiB |
| Other JSON payload | 16 MiB |

The writer always uses ZIP method 0 (store), so its compression ratio is 1 and
there is no decompression amplification. The constants are exposed in
`cadweb/CadWebLimits.h`; exceeding one throws `std::length_error`.

`writeAtomically` writes the payload inside an
unpredictable sibling temporary directory, requests owner-only permissions,
and publishes it with
`std::filesystem::create_hard_link`. Hard-link creation is the portable C++17
operation that is atomic and does not replace a concurrently created
destination. The temporary link and directory are removed after publication.

The destination must not exist. A filesystem without same-volume hard-link
support fails safely and leaves the destination untouched; the writer does not
fall back to POSIX `rename`, whose replace behavior would violate that promise.
C++17 does not guarantee that `std::random_device` is cryptographically secure,
that POSIX-style permission bits map to restrictive ACLs on every platform, or
that a particular filesystem implements hard-link creation with local-filesystem
atomicity. Unsupported filesystems fail rather than using an unsafe fallback.
The standard API also cannot defend against a malicious process running as the
same account inside the short create/write window and provides no portable
`fsync`. A cleanup failure is reported even if the valid destination link was
already published.

## Save Sync durable handoff

`CadWebDurableStore` keeps the native journal below `state/` and publishes
immutable upload items below `outbox/items/`. A package is copied and verified
in `<artifactId>.preparing-*`, atomically promoted to `<artifactId>.staged`, and
remains invisible there while the plug-in persists `sealed-publish-required`
plus its pending semantic index. Only then is the directory renamed to
`<artifactId>.ready`. The daemon must poll directories ending exactly in
`.ready` and ignore every other suffix.

Each ready directory contains `item.json` and exactly one fixed payload name:
`payload.cadwebdelta` for `artifactKind=delta`, or `payload.cadweb` for
`artifactKind=snapshot`. Manifest schema version 1 carries `artifactId`,
`saveToken`, `drawingId`, `modelEpoch`, `writerSessionId`, `baseRevision`,
`resultStateHash`, and payload `fileName/size/sha256`. Daemon retry state does
not mutate this manifest. After a server ACK it writes `ack.json` atomically;
the ACK must assign exactly `baseRevision + 1`. Native code first persists the
new ACKed baseline, then removes the ready directory and compacts acknowledged
local records.

The default store is `%LOCALAPPDATA%/AcadStudio/CadWebSync` on Windows and
`~/Library/Application Support/AcadStudio/CadWebSync` on macOS. Tests and
deployments may override it with `CADWEB_SYNC_ROOT`. A server-issued initial
binding is provisioned as `bindings/<canonicalFingerprint>.json` with
`schemaVersion=1`, `drawingId`, `sourceFingerprint`, `modelEpoch`,
`writerSessionId`, and `baseRevision=0`; the plug-in never derives `drawingId`
from a path or DWG fingerprint.

The native durable payload limit and the uploader/server default are the same
hard maximum of 256 MiB; a deployment may configure a lower limit but not a
higher one. On first use the daemon atomically claims a sync root by writing
`scope.json` with one `tenantId` and `projectId`. Every later list, read, write,
or ACK validates that marker, and an invalid or mismatching scope fails closed
before any network request. A root therefore belongs to one tenant and project
even though it may contain multiple drawing lineages.

FlatBuffers 25.9.23 runtime headers and its Apache-2.0 license are vendored in
`third_party/flatbuffers`. `generated/geometry_generated.h` was produced from
`../schema/geometry.fbs` with the official compiler:

```sh
flatc --cpp --cpp-std c++17 -o core/generated schema/geometry.fbs
```

Run native tests from the repository root:

```sh
make -C cad-platform/tests/native test
```
