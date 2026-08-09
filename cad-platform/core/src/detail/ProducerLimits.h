#pragma once

#include <cstddef>
#include <string_view>
#include <vector>

namespace cadweb::detail {

struct ProducerEntrySize {
  std::string_view path;
  std::size_t bytes = 0U;
  bool json = false;
};

// Validates both uncompressed payload limits and the exact byte size of the
// deterministic ZIP-store envelope before the archive is allocated.
void validateProducerSizes(const std::vector<ProducerEntrySize>& entries);

}  // namespace cadweb::detail
