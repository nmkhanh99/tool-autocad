#include "detail/ZipStore.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <set>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace cadweb::detail {
namespace {

constexpr std::uint16_t kUtf8Flag = 0x0800U;
constexpr std::uint16_t kStoreMethod = 0U;
constexpr std::uint16_t kDosTime = 0U;
constexpr std::uint16_t kDosDate = 0x0021U;  // 1980-01-01

void append16(std::vector<std::uint8_t>& output, std::uint16_t value) {
  output.push_back(static_cast<std::uint8_t>(value));
  output.push_back(static_cast<std::uint8_t>(value >> 8U));
}

void append32(std::vector<std::uint8_t>& output, std::uint32_t value) {
  output.push_back(static_cast<std::uint8_t>(value));
  output.push_back(static_cast<std::uint8_t>(value >> 8U));
  output.push_back(static_cast<std::uint8_t>(value >> 16U));
  output.push_back(static_cast<std::uint8_t>(value >> 24U));
}

std::uint32_t crc32(const std::vector<std::uint8_t>& bytes) {
  std::uint32_t crc = 0xffffffffU;
  for (const auto byte : bytes) {
    crc ^= byte;
    for (int bit = 0; bit < 8; ++bit) {
      const auto mask = static_cast<std::uint32_t>(
          -static_cast<std::int32_t>(crc & 1U));
      crc = (crc >> 1U) ^ (0xedb88320U & mask);
    }
  }
  return ~crc;
}

bool isSafePath(std::string_view path) {
  if (path.empty() || path.front() == '/' || path.back() == '/' ||
      path.find('\\') != std::string_view::npos ||
      path.find('\0') != std::string_view::npos ||
      path.find("//") != std::string_view::npos) {
    return false;
  }
  if (path.size() >= 2U &&
      ((path[0] >= 'A' && path[0] <= 'Z') ||
       (path[0] >= 'a' && path[0] <= 'z')) &&
      path[1] == ':') {
    return false;
  }

  std::size_t segmentStart = 0U;
  while (segmentStart < path.size()) {
    const auto slash = path.find('/', segmentStart);
    const auto segment = path.substr(
        segmentStart,
        slash == std::string_view::npos ? path.size() - segmentStart
                                        : slash - segmentStart);
    if (segment == "." || segment == "..") {
      return false;
    }
    if (slash == std::string_view::npos) {
      break;
    }
    segmentStart = slash + 1U;
  }
  return true;
}

struct CentralRecord {
  const ZipEntry* entry = nullptr;
  std::uint32_t crc = 0;
  std::uint32_t localOffset = 0;
};

std::uint32_t checked32(std::size_t value, const char* description) {
  if (value > std::numeric_limits<std::uint32_t>::max()) {
    throw std::length_error(std::string(description) +
                            " exceeds the ZIP32 limit");
  }
  return static_cast<std::uint32_t>(value);
}

}  // namespace

std::vector<std::uint8_t> buildZipStore(std::vector<ZipEntry> entries) {
  if (entries.size() > std::numeric_limits<std::uint16_t>::max()) {
    throw std::length_error("too many ZIP entries");
  }

  std::set<std::string> paths;
  for (const auto& entry : entries) {
    if (!isSafePath(entry.path)) {
      throw std::invalid_argument("unsafe ZIP entry path: " + entry.path);
    }
    if (entry.path.size() > std::numeric_limits<std::uint16_t>::max()) {
      throw std::length_error("ZIP entry path is too long: " + entry.path);
    }
    if (!paths.insert(entry.path).second) {
      throw std::invalid_argument("duplicate ZIP entry path: " + entry.path);
    }
    checked32(entry.bytes.size(), "ZIP entry");
  }

  std::sort(entries.begin(), entries.end(),
            [](const ZipEntry& left, const ZipEntry& right) {
              return left.path < right.path;
            });

  std::vector<std::uint8_t> output;
  std::vector<CentralRecord> centralRecords;
  centralRecords.reserve(entries.size());

  for (const auto& entry : entries) {
    const auto localOffset = checked32(output.size(), "ZIP archive");
    const auto size = checked32(entry.bytes.size(), "ZIP entry");
    const auto checksum = crc32(entry.bytes);

    append32(output, 0x04034b50U);
    append16(output, 20U);
    append16(output, kUtf8Flag);
    append16(output, kStoreMethod);
    append16(output, kDosTime);
    append16(output, kDosDate);
    append32(output, checksum);
    append32(output, size);
    append32(output, size);
    append16(output, static_cast<std::uint16_t>(entry.path.size()));
    append16(output, 0U);
    output.insert(output.end(), entry.path.begin(), entry.path.end());
    output.insert(output.end(), entry.bytes.begin(), entry.bytes.end());

    centralRecords.push_back(CentralRecord{&entry, checksum, localOffset});
  }

  const auto centralOffset = checked32(output.size(), "ZIP archive");
  for (const auto& record : centralRecords) {
    const auto size = checked32(record.entry->bytes.size(), "ZIP entry");
    append32(output, 0x02014b50U);
    append16(output, 20U);
    append16(output, 20U);
    append16(output, kUtf8Flag);
    append16(output, kStoreMethod);
    append16(output, kDosTime);
    append16(output, kDosDate);
    append32(output, record.crc);
    append32(output, size);
    append32(output, size);
    append16(output,
             static_cast<std::uint16_t>(record.entry->path.size()));
    append16(output, 0U);
    append16(output, 0U);
    append16(output, 0U);
    append16(output, 0U);
    append32(output, 0U);
    append32(output, record.localOffset);
    output.insert(output.end(), record.entry->path.begin(),
                  record.entry->path.end());
  }

  const auto centralSize = checked32(output.size() - centralOffset,
                                     "ZIP central directory");
  append32(output, 0x06054b50U);
  append16(output, 0U);
  append16(output, 0U);
  append16(output, static_cast<std::uint16_t>(entries.size()));
  append16(output, static_cast<std::uint16_t>(entries.size()));
  append32(output, centralSize);
  append32(output, centralOffset);
  append16(output, 0U);

  return output;
}

}  // namespace cadweb::detail
