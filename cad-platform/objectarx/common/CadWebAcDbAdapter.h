#pragma once

#include "cadweb/CadDocument.h"

#include <dbid.h>

#include <optional>
#include <vector>

class AcDbDatabase;

namespace cadweb::objectarx {

struct SnapshotOptions {
  // Empty means export the full model space. When selectedOnly is true, every
  // id is validated against database and only those top-level entities plus
  // transitive block definitions are exported.
  bool selectedOnly = false;
  std::vector<AcDbObjectId> selectedIds;

  // A revision-bound snapshot always exports the full supported model and uses
  // canonical kind:handle IDs. Initial base revision 0 may choose its origin
  // from extents; recovery snapshots must provide the epoch's fixed origin.
  std::optional<SyncBinding> syncBinding;
  std::optional<Vec3> fixedOrigin;
};

// Must be called while database is readable in a valid AutoCAD command or
// document context. No AcDb object escapes this call.
CadDocument snapshotDatabase(AcDbDatabase* database,
                             const SnapshotOptions& options = {});

}  // namespace cadweb::objectarx
