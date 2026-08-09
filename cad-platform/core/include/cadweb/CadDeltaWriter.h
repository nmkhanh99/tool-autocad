#pragma once

#include "cadweb/CadDelta.h"

#include <cstdint>
#include <filesystem>
#include <vector>

namespace cadweb {

class CadDeltaWriter {
 public:
  // Builds a deterministic ZIP-store .cadwebdelta archive. Invalid DTOs throw
  // std::invalid_argument; incompatible sizes throw std::length_error.
  std::vector<std::uint8_t> build(const CadDelta& delta) const;

  // Publishes a complete archive without replacing an existing destination.
  void writeAtomically(const CadDelta& delta,
                       const std::filesystem::path& destination) const;
};

}  // namespace cadweb
