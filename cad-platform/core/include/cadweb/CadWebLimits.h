#pragma once

#include <cstddef>

namespace cadweb::limits {

inline constexpr std::size_t kMaxArchiveBytes = 256U * 1024U * 1024U;
inline constexpr std::size_t kMaxEntries = 128U;
inline constexpr std::size_t kMaxEntryUncompressedBytes =
    128U * 1024U * 1024U;
inline constexpr std::size_t kMaxTotalUncompressedBytes =
    256U * 1024U * 1024U;
inline constexpr std::size_t kMaxManifestBytes = 1U * 1024U * 1024U;
inline constexpr std::size_t kMaxJsonPayloadBytes = 16U * 1024U * 1024U;

}  // namespace cadweb::limits
