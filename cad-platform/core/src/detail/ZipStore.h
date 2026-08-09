#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace cadweb::detail {

struct ZipEntry {
  std::string path;
  std::vector<std::uint8_t> bytes;
};

std::vector<std::uint8_t> buildZipStore(std::vector<ZipEntry> entries);

}  // namespace cadweb::detail
