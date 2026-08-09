#pragma once

#include "cadweb/CadDocument.h"

#include <cstdint>
#include <filesystem>
#include <vector>

namespace cadweb {

class CadWebWriter {
 public:
  // Builds a deterministic ZIP-store archive. Invalid DTOs throw
  // std::invalid_argument; reader-incompatible payload/archive sizes throw
  // std::length_error before any output file is published.
  std::vector<std::uint8_t> build(const CadDocument& document) const;

  // Writes inside an unpredictable, permission-restricted sibling directory,
  // then publishes the complete file with a no-replace hard-link operation.
  // The destination must not exist and the filesystem must support hard links.
  void writeAtomically(const CadDocument& document,
                       const std::filesystem::path& destination) const;
};

}  // namespace cadweb
