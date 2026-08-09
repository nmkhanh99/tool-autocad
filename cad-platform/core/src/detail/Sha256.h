#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace cadweb::detail {

std::array<std::uint8_t, 32> sha256(
    const std::vector<std::uint8_t>& bytes);
std::string sha256Hex(const std::vector<std::uint8_t>& bytes);

}  // namespace cadweb::detail
