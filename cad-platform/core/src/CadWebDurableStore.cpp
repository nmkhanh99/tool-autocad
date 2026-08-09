#include "cadweb/CadWebDurableStore.h"

#include "detail/Sha256.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstring>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <Windows.h>
#include <fcntl.h>
#include <io.h>
#include <sys/stat.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace cadweb {
namespace {

constexpr std::size_t kMaxLocalJsonBytes = 1024U * 1024U;
constexpr std::size_t kMaxStateBytes = 128U * 1024U * 1024U;
constexpr std::size_t kMaxStateStringBytes = 1024U * 1024U;
constexpr std::size_t kMaxJournalRecords = 4096U;
constexpr std::size_t kMaxStateOutboxItems = 256U;
constexpr std::size_t kMaxObjectHashes = 1000000U;
constexpr std::uint64_t kMaxJsonSafeInteger = 9007199254740991ULL;
constexpr std::array<std::uint8_t, 8> kStateMagic{
    'C', 'W', 'S', 'T', 'A', 'T', 'E', '1'};
constexpr std::uint32_t kStateVersion = 1U;

std::atomic<std::uint64_t> gTemporarySequence{1U};

void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

bool isLowerHexDigest(const std::string& value) {
  return value.size() == 64U &&
         std::all_of(value.begin(), value.end(), [](unsigned char byte) {
           return std::isdigit(byte) || (byte >= 'a' && byte <= 'f');
         });
}

bool isPathIdentifier(const std::string& value) {
  return !value.empty() && value.size() <= 128U && value != "." &&
         value != ".." &&
         std::all_of(value.begin(), value.end(), [](unsigned char byte) {
           return std::isalnum(byte) || byte == '-' || byte == '_' ||
                  byte == '.';
         });
}

std::string fingerprintStorageKey(const std::string& fingerprint) {
  require(!fingerprint.empty() && fingerprint.size() <= 128U,
          "source fingerprint is invalid for durable storage");
  std::string result;
  result.reserve(fingerprint.size());
  for (const auto value : fingerprint) {
    const auto byte = static_cast<unsigned char>(value);
    if (value == '{' || value == '}') continue;
    require(std::isalnum(byte) || value == '-',
            "source fingerprint contains a path-unsafe character");
    result.push_back(static_cast<char>(std::toupper(byte)));
  }
  require(isPathIdentifier(result),
          "source fingerprint does not produce a storage key");
  return result;
}

std::string jsonString(std::string_view value) {
  std::string result = "\"";
  for (const auto character : value) {
    const auto byte = static_cast<unsigned char>(character);
    switch (character) {
      case '\"':
        result += "\\\"";
        break;
      case '\\':
        result += "\\\\";
        break;
      case '\b':
        result += "\\b";
        break;
      case '\f':
        result += "\\f";
        break;
      case '\n':
        result += "\\n";
        break;
      case '\r':
        result += "\\r";
        break;
      case '\t':
        result += "\\t";
        break;
      default:
        require(byte >= 0x20U, "JSON string contains a control character");
        result.push_back(character);
        break;
    }
  }
  result.push_back('\"');
  return result;
}

void requireJsonObjectEnvelope(const std::string& json) {
  std::size_t begin = 0U;
  while (begin < json.size() &&
         std::isspace(static_cast<unsigned char>(json[begin]))) {
    ++begin;
  }
  std::size_t end = json.size();
  while (end > begin &&
         std::isspace(static_cast<unsigned char>(json[end - 1U]))) {
    --end;
  }
  require(begin < end && json[begin] == '{' && json[end - 1U] == '}',
          "local JSON object envelope is invalid");
}

std::size_t memberValueOffset(const std::string& json,
                              const std::string& key) {
  requireJsonObjectEnvelope(json);
  const std::string needle = "\"" + key + "\"";
  const auto keyAt = json.find(needle);
  require(keyAt != std::string::npos,
          "local JSON is missing field: " + key);
  require(json.find(needle, keyAt + needle.size()) == std::string::npos,
          "local JSON contains duplicate field: " + key);
  auto cursor = keyAt + needle.size();
  while (cursor < json.size() &&
         std::isspace(static_cast<unsigned char>(json[cursor]))) {
    ++cursor;
  }
  require(cursor < json.size() && json[cursor++] == ':',
          "local JSON field has no value: " + key);
  while (cursor < json.size() &&
         std::isspace(static_cast<unsigned char>(json[cursor]))) {
    ++cursor;
  }
  require(cursor < json.size(), "local JSON field value is truncated: " + key);
  return cursor;
}

void requireMemberDelimiter(const std::string& json, std::size_t cursor,
                            const std::string& key) {
  while (cursor < json.size() &&
         std::isspace(static_cast<unsigned char>(json[cursor]))) {
    ++cursor;
  }
  require(cursor < json.size() &&
              (json[cursor] == ',' || json[cursor] == '}'),
          "local JSON field has invalid trailing data: " + key);
}

std::string parseJsonStringField(const std::string& json,
                                 const std::string& key) {
  auto cursor = memberValueOffset(json, key);
  require(json[cursor++] == '\"',
          "local JSON field must be a string: " + key);
  std::string result;
  while (cursor < json.size()) {
    const char value = json[cursor++];
    if (value == '\"') {
      requireMemberDelimiter(json, cursor, key);
      return result;
    }
    require(static_cast<unsigned char>(value) >= 0x20U,
            "local JSON string contains a control character");
    if (value != '\\') {
      result.push_back(value);
      continue;
    }
    require(cursor < json.size(), "local JSON escape is truncated");
    switch (json[cursor++]) {
      case '\"':
        result.push_back('\"');
        break;
      case '\\':
        result.push_back('\\');
        break;
      case '/':
        result.push_back('/');
        break;
      case 'b':
        result.push_back('\b');
        break;
      case 'f':
        result.push_back('\f');
        break;
      case 'n':
        result.push_back('\n');
        break;
      case 'r':
        result.push_back('\r');
        break;
      case 't':
        result.push_back('\t');
        break;
      default:
        throw std::runtime_error("unsupported escape in local JSON field: " +
                                 key);
    }
  }
  throw std::runtime_error("local JSON string is unterminated: " + key);
}

std::uint64_t parseJsonUintField(const std::string& json,
                                 const std::string& key) {
  auto cursor = memberValueOffset(json, key);
  const auto begin = json.data() + cursor;
  const auto end = json.data() + json.size();
  std::uint64_t result = 0U;
  const auto parsed = std::from_chars(begin, end, result);
  require(parsed.ec == std::errc{} && parsed.ptr != begin,
          "local JSON field must be an unsigned integer: " + key);
  requireMemberDelimiter(
      json, static_cast<std::size_t>(parsed.ptr - json.data()), key);
  return result;
}

std::vector<std::uint8_t> readFile(const std::filesystem::path& path,
                                   std::uint64_t limit) {
  std::error_code error;
  const auto size = std::filesystem::file_size(path, error);
  require(!error && size <= limit &&
              size <= static_cast<std::uint64_t>(
                          std::numeric_limits<std::size_t>::max()),
          "local file is missing or exceeds its size limit: " + path.string());
  std::ifstream stream(path, std::ios::binary);
  require(stream.good(), "cannot open local file: " + path.string());
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
  if (!bytes.empty()) {
    stream.read(reinterpret_cast<char*>(bytes.data()),
                static_cast<std::streamsize>(bytes.size()));
  }
  require(stream.good() || stream.eof(),
          "cannot read local file: " + path.string());
  require(static_cast<std::size_t>(stream.gcount()) == bytes.size() ||
              bytes.empty(),
          "local file was truncated while reading: " + path.string());
  return bytes;
}

std::string readTextFile(const std::filesystem::path& path,
                         std::size_t limit = kMaxLocalJsonBytes) {
  const auto bytes = readFile(path, limit);
  return std::string(bytes.begin(), bytes.end());
}

void syncFile(const std::filesystem::path& path) {
#ifdef _WIN32
  const int descriptor =
      ::_wopen(path.c_str(), _O_RDONLY | _O_BINARY, _S_IREAD);
  require(descriptor >= 0, "cannot reopen durable file: " + path.string());
  const int result = ::_commit(descriptor);
  ::_close(descriptor);
  require(result == 0, "cannot flush durable file: " + path.string());
#else
  const int descriptor = ::open(path.c_str(), O_RDONLY);
  require(descriptor >= 0, "cannot reopen durable file: " + path.string());
  const int result = ::fsync(descriptor);
  ::close(descriptor);
  require(result == 0, "cannot flush durable file: " + path.string());
#endif
}

void syncDirectory(const std::filesystem::path& path) {
#ifndef _WIN32
  const int descriptor = ::open(path.c_str(), O_RDONLY | O_DIRECTORY);
  require(descriptor >= 0,
          "cannot open durable directory: " + path.string());
  const int result = ::fsync(descriptor);
  ::close(descriptor);
  require(result == 0,
          "cannot flush durable directory: " + path.string());
#else
  (void)path;
#endif
}

void replacePathAtomically(const std::filesystem::path& temporary,
                           const std::filesystem::path& destination) {
#ifdef _WIN32
  require(::MoveFileExW(temporary.c_str(), destination.c_str(),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0,
          "cannot atomically replace durable file: " + destination.string());
#else
  std::error_code error;
  std::filesystem::rename(temporary, destination, error);
  require(!error,
          "cannot atomically replace durable file: " + destination.string());
#endif
}

void renameDirectoryAtomically(const std::filesystem::path& source,
                               const std::filesystem::path& destination) {
#ifdef _WIN32
  require(::MoveFileExW(source.c_str(), destination.c_str(),
                        MOVEFILE_WRITE_THROUGH) != 0,
          "cannot atomically publish durable directory: " +
              destination.string());
#else
  std::error_code error;
  std::filesystem::rename(source, destination, error);
  require(!error, "cannot atomically publish durable directory: " +
                      destination.string());
#endif
}

std::filesystem::path temporarySibling(
    const std::filesystem::path& destination, std::string_view marker) {
  return destination.parent_path() /
         (destination.filename().string() + std::string(marker) +
          std::to_string(gTemporarySequence.fetch_add(1U)));
}

void writeFileAtomically(const std::filesystem::path& destination,
                         const std::vector<std::uint8_t>& bytes) {
  std::error_code error;
  std::filesystem::create_directories(destination.parent_path(), error);
  require(!error, "cannot create durable directory: " +
                      destination.parent_path().string());
  const auto temporary = temporarySibling(destination, ".tmp-");
  try {
    std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
    require(stream.good(), "cannot create temporary durable file");
    if (!bytes.empty()) {
      stream.write(reinterpret_cast<const char*>(bytes.data()),
                   static_cast<std::streamsize>(bytes.size()));
    }
    stream.flush();
    require(stream.good(), "cannot write temporary durable file");
    stream.close();
    require(stream.good(), "cannot close temporary durable file");
    syncFile(temporary);
    replacePathAtomically(temporary, destination);
    syncDirectory(destination.parent_path());
  } catch (...) {
    std::filesystem::remove(temporary, error);
    throw;
  }
}

void writeTextAtomically(const std::filesystem::path& destination,
                         const std::string& text) {
  writeFileAtomically(destination,
                      std::vector<std::uint8_t>(text.begin(), text.end()));
}

class Encoder {
 public:
  void byte(std::uint8_t value) { bytes_.push_back(value); }

  void uint32(std::uint32_t value) {
    for (unsigned shift = 0U; shift < 32U; shift += 8U) {
      byte(static_cast<std::uint8_t>(value >> shift));
    }
  }

  void uint64(std::uint64_t value) {
    for (unsigned shift = 0U; shift < 64U; shift += 8U) {
      byte(static_cast<std::uint8_t>(value >> shift));
    }
  }

  void boolean(bool value) { byte(value ? 1U : 0U); }

  void string(const std::string& value) {
    require(value.size() <= kMaxStateStringBytes &&
                value.size() <=
                    static_cast<std::size_t>(
                        std::numeric_limits<std::uint32_t>::max()),
            "durable state string exceeds its limit");
    uint32(static_cast<std::uint32_t>(value.size()));
    bytes_.insert(bytes_.end(), value.begin(), value.end());
  }

  void number(double value) {
    require(std::isfinite(value), "durable state contains a non-finite number");
    std::uint64_t bits = 0U;
    static_assert(sizeof(bits) == sizeof(value));
    std::memcpy(&bits, &value, sizeof(bits));
    uint64(bits);
  }

  std::vector<std::uint8_t> finish() && { return std::move(bytes_); }

 private:
  std::vector<std::uint8_t> bytes_;
};

class Decoder {
 public:
  explicit Decoder(const std::vector<std::uint8_t>& bytes) : bytes_(bytes) {}

  std::uint8_t byte() {
    require(cursor_ < bytes_.size(), "durable state is truncated");
    return bytes_[cursor_++];
  }

  std::uint32_t uint32() {
    std::uint32_t result = 0U;
    for (unsigned shift = 0U; shift < 32U; shift += 8U) {
      result |= static_cast<std::uint32_t>(byte()) << shift;
    }
    return result;
  }

  std::uint64_t uint64() {
    std::uint64_t result = 0U;
    for (unsigned shift = 0U; shift < 64U; shift += 8U) {
      result |= static_cast<std::uint64_t>(byte()) << shift;
    }
    return result;
  }

  bool boolean() {
    const auto value = byte();
    require(value <= 1U, "durable state contains an invalid boolean");
    return value != 0U;
  }

  std::string string() {
    const auto size = static_cast<std::size_t>(uint32());
    require(size <= kMaxStateStringBytes && size <= bytes_.size() - cursor_,
            "durable state string is truncated or oversized");
    std::string result(bytes_.begin() + static_cast<std::ptrdiff_t>(cursor_),
                       bytes_.begin() +
                           static_cast<std::ptrdiff_t>(cursor_ + size));
    cursor_ += size;
    return result;
  }

  double number() {
    const auto bits = uint64();
    double result = 0.0;
    std::memcpy(&result, &bits, sizeof(result));
    require(std::isfinite(result),
            "durable state contains a non-finite number");
    return result;
  }

  void requireDone() const {
    require(cursor_ == bytes_.size(), "durable state has trailing bytes");
  }

 private:
  const std::vector<std::uint8_t>& bytes_;
  std::size_t cursor_ = 0U;
};

void encodeEvidence(Encoder& encoder, const SavedFileEvidence& evidence) {
  encoder.string(evidence.actualTarget);
  encoder.string(evidence.sourceFingerprint);
  encoder.string(evidence.dwgVersion);
  encoder.string(evidence.versionToken);
}

SavedFileEvidence decodeEvidence(Decoder& decoder) {
  SavedFileEvidence evidence;
  evidence.actualTarget = decoder.string();
  evidence.sourceFingerprint = decoder.string();
  evidence.dwgVersion = decoder.string();
  evidence.versionToken = decoder.string();
  return evidence;
}

void encodeIndex(Encoder& encoder, const CadRevisionIndex& index) {
  encoder.string(index.drawingId);
  encoder.string(index.sourceFingerprint);
  encoder.string(index.modelEpoch);
  encoder.uint64(index.revision);
  encoder.string(index.units.name);
  encoder.boolean(index.units.metersPerUnit.has_value());
  if (index.units.metersPerUnit) encoder.number(*index.units.metersPerUnit);
  encoder.number(index.origin.x);
  encoder.number(index.origin.y);
  encoder.number(index.origin.z);
  encoder.boolean(index.modelEmpty);
  encoder.number(index.resultExtents.min.x);
  encoder.number(index.resultExtents.min.y);
  encoder.number(index.resultExtents.min.z);
  encoder.number(index.resultExtents.max.x);
  encoder.number(index.resultExtents.max.y);
  encoder.number(index.resultExtents.max.z);
  require(index.objectHashes.size() <= kMaxObjectHashes,
          "revision index exceeds the durable object limit");
  encoder.uint32(static_cast<std::uint32_t>(index.objectHashes.size()));
  for (const auto& object : index.objectHashes) {
    encoder.string(object.first);
    encoder.string(object.second);
  }
  encoder.string(index.stateHash);
}

CadRevisionIndex decodeIndex(Decoder& decoder) {
  CadRevisionIndex index;
  index.drawingId = decoder.string();
  index.sourceFingerprint = decoder.string();
  index.modelEpoch = decoder.string();
  index.revision = decoder.uint64();
  index.units.name = decoder.string();
  if (decoder.boolean()) index.units.metersPerUnit = decoder.number();
  index.origin = {decoder.number(), decoder.number(), decoder.number()};
  index.modelEmpty = decoder.boolean();
  index.resultExtents = {{decoder.number(), decoder.number(), decoder.number()},
                         {decoder.number(), decoder.number(), decoder.number()}};
  const auto count = static_cast<std::size_t>(decoder.uint32());
  require(count <= kMaxObjectHashes,
          "durable revision index exceeds its object limit");
  for (std::size_t item = 0U; item < count; ++item) {
    require(index.objectHashes.emplace(decoder.string(), decoder.string()).second,
            "durable revision index contains a duplicate key");
  }
  index.stateHash = decoder.string();
  return index;
}

void encodeSaveSync(Encoder& encoder, const SaveSyncState& state) {
  encoder.boolean(state.acknowledgedBaseline.has_value());
  if (state.acknowledgedBaseline) {
    const auto& baseline = *state.acknowledgedBaseline;
    encoder.string(baseline.drawingId);
    encoder.string(baseline.modelEpoch);
    encoder.uint64(baseline.revision);
    encoder.string(baseline.stateHash);
    encodeEvidence(encoder, baseline.fileEvidence);
  }

  require(state.journals.size() <= kMaxJournalRecords,
          "durable journal record limit exceeded");
  encoder.uint32(static_cast<std::uint32_t>(state.journals.size()));
  for (const auto& journal : state.journals) {
    encoder.string(journal.saveToken);
    encoder.string(journal.drawingId);
    encoder.string(journal.modelEpoch);
    encoder.uint64(journal.baseRevision);
    encoder.string(journal.intendedTarget);
    encoder.byte(static_cast<std::uint8_t>(journal.phase));
    encoder.boolean(journal.savedFileEvidence.has_value());
    if (journal.savedFileEvidence) {
      encodeEvidence(encoder, *journal.savedFileEvidence);
    }
    encoder.string(journal.capturedStateHash);
    encoder.string(journal.artifactId);
  }

  require(state.outbox.size() <= kMaxStateOutboxItems,
          "durable outbox record limit exceeded");
  encoder.uint32(static_cast<std::uint32_t>(state.outbox.size()));
  for (const auto& item : state.outbox) {
    encoder.string(item.saveToken);
    encoder.byte(static_cast<std::uint8_t>(item.artifactKind));
    encoder.string(item.artifactId);
    encoder.string(item.drawingId);
    encoder.string(item.modelEpoch);
    encoder.string(item.writerSessionId);
    encoder.uint64(item.baseRevision);
    encoder.string(item.resultStateHash);
    encoder.string(item.payloadPath);
    encoder.string(item.payloadSha256);
    encoder.uint64(item.payloadSize);
    encoder.boolean(item.payloadIsDurable);
    encoder.boolean(item.acknowledged);
  }

  encoder.uint32(static_cast<std::uint32_t>(state.fallbackReasons.size()));
  for (const auto reason : state.fallbackReasons) {
    encoder.byte(static_cast<std::uint8_t>(reason));
  }
}

template <typename Enum>
Enum checkedEnum(std::uint8_t value, std::uint8_t minimum,
                 std::uint8_t maximum, const char* field) {
  require(value >= minimum && value <= maximum,
          std::string("durable state contains an invalid ") + field);
  return static_cast<Enum>(value);
}

SaveSyncState decodeSaveSync(Decoder& decoder) {
  SaveSyncState state;
  if (decoder.boolean()) {
    TrustedBaseline baseline;
    baseline.drawingId = decoder.string();
    baseline.modelEpoch = decoder.string();
    baseline.revision = decoder.uint64();
    baseline.stateHash = decoder.string();
    baseline.fileEvidence = decodeEvidence(decoder);
    state.acknowledgedBaseline = std::move(baseline);
  }

  const auto journalCount = static_cast<std::size_t>(decoder.uint32());
  require(journalCount <= kMaxJournalRecords,
          "durable journal record count exceeds its limit");
  state.journals.reserve(journalCount);
  for (std::size_t index = 0U; index < journalCount; ++index) {
    SaveJournalRecord journal;
    journal.saveToken = decoder.string();
    journal.drawingId = decoder.string();
    journal.modelEpoch = decoder.string();
    journal.baseRevision = decoder.uint64();
    journal.intendedTarget = decoder.string();
    journal.phase = checkedEnum<SaveJournalPhase>(
        decoder.byte(), static_cast<std::uint8_t>(SaveJournalPhase::Begun),
        static_cast<std::uint8_t>(SaveJournalPhase::RecoveryRequired),
        "journal phase");
    if (decoder.boolean()) journal.savedFileEvidence = decodeEvidence(decoder);
    journal.capturedStateHash = decoder.string();
    journal.artifactId = decoder.string();
    state.journals.push_back(std::move(journal));
  }

  const auto outboxCount = static_cast<std::size_t>(decoder.uint32());
  require(outboxCount <= kMaxStateOutboxItems,
          "durable outbox record count exceeds its limit");
  state.outbox.reserve(outboxCount);
  for (std::size_t index = 0U; index < outboxCount; ++index) {
    OutboxItem item;
    item.saveToken = decoder.string();
    item.artifactKind = checkedEnum<OutboxArtifactKind>(
        decoder.byte(), static_cast<std::uint8_t>(OutboxArtifactKind::Delta),
        static_cast<std::uint8_t>(OutboxArtifactKind::Snapshot),
        "outbox artifact kind");
    item.artifactId = decoder.string();
    item.drawingId = decoder.string();
    item.modelEpoch = decoder.string();
    item.writerSessionId = decoder.string();
    item.baseRevision = decoder.uint64();
    item.resultStateHash = decoder.string();
    item.payloadPath = decoder.string();
    item.payloadSha256 = decoder.string();
    item.payloadSize = decoder.uint64();
    item.payloadIsDurable = decoder.boolean();
    item.acknowledged = decoder.boolean();
    state.outbox.push_back(std::move(item));
  }

  const auto reasonCount = static_cast<std::size_t>(decoder.uint32());
  require(reasonCount <= 64U,
          "durable fallback reason count exceeds its limit");
  for (std::size_t index = 0U; index < reasonCount; ++index) {
    state.fallbackReasons.insert(checkedEnum<FullSnapshotReason>(
        decoder.byte(), static_cast<std::uint8_t>(FullSnapshotReason::UndoRedo),
        static_cast<std::uint8_t>(
            FullSnapshotReason::CandidateLimitExceeded),
        "full-snapshot reason"));
  }
  return state;
}

std::vector<std::uint8_t> encodeDocumentState(
    const DurableDocumentSyncState& state) {
  Encoder encoder;
  for (const auto value : kStateMagic) encoder.byte(value);
  encoder.uint32(kStateVersion);
  encoder.string(state.binding.drawingId);
  encoder.string(state.binding.sourceFingerprint);
  encoder.string(state.binding.modelEpoch);
  encoder.string(state.binding.writerSessionId);
  encodeSaveSync(encoder, state.saveSync);
  encoder.boolean(state.acknowledgedIndex.has_value());
  if (state.acknowledgedIndex) encodeIndex(encoder, *state.acknowledgedIndex);
  encoder.boolean(state.pendingIndex.has_value());
  if (state.pendingIndex) encodeIndex(encoder, *state.pendingIndex);
  encoder.string(state.pendingArtifactId);
  auto bytes = std::move(encoder).finish();
  require(bytes.size() <= kMaxStateBytes,
          "durable document state exceeds its file limit");
  return bytes;
}

DurableDocumentSyncState decodeDocumentState(
    const std::vector<std::uint8_t>& bytes) {
  Decoder decoder(bytes);
  for (const auto value : kStateMagic) {
    require(decoder.byte() == value, "durable document state magic is invalid");
  }
  require(decoder.uint32() == kStateVersion,
          "durable document state version is unsupported");
  DurableDocumentSyncState state;
  state.binding.drawingId = decoder.string();
  state.binding.sourceFingerprint = decoder.string();
  state.binding.modelEpoch = decoder.string();
  state.binding.writerSessionId = decoder.string();
  state.saveSync = decodeSaveSync(decoder);
  if (decoder.boolean()) state.acknowledgedIndex = decodeIndex(decoder);
  if (decoder.boolean()) state.pendingIndex = decodeIndex(decoder);
  state.pendingArtifactId = decoder.string();
  decoder.requireDone();
  return state;
}

void validateBinding(const ProvisionedWriterBinding& binding) {
  require(!binding.drawingId.empty() && !binding.sourceFingerprint.empty() &&
              !binding.modelEpoch.empty() && !binding.writerSessionId.empty(),
          "writer binding is incomplete");
  (void)fingerprintStorageKey(binding.sourceFingerprint);
}

void validateDocumentState(const DurableDocumentSyncState& state) {
  validateBinding(state.binding);
  if (state.acknowledgedIndex) {
    require(state.saveSync.acknowledgedBaseline.has_value(),
            "acknowledged index has no journal baseline");
    const auto& index = *state.acknowledgedIndex;
    const auto& baseline = *state.saveSync.acknowledgedBaseline;
    require(index.drawingId == state.binding.drawingId &&
                index.sourceFingerprint == state.binding.sourceFingerprint &&
                index.modelEpoch == state.binding.modelEpoch &&
                index.drawingId == baseline.drawingId &&
                index.modelEpoch == baseline.modelEpoch &&
                index.revision == baseline.revision &&
                index.stateHash == baseline.stateHash,
            "acknowledged index does not match the durable binding/baseline");
  } else {
    require(!state.saveSync.acknowledgedBaseline,
            "journal baseline has no acknowledged revision index");
  }
  require(state.pendingIndex.has_value() == !state.pendingArtifactId.empty(),
          "pending revision index identity is incomplete");
  if (state.pendingIndex) {
    require(state.pendingIndex->drawingId == state.binding.drawingId &&
                state.pendingIndex->sourceFingerprint ==
                    state.binding.sourceFingerprint &&
                state.pendingIndex->modelEpoch == state.binding.modelEpoch,
            "pending revision index does not match the durable binding");
  }
}

std::string bindingJson(const ProvisionedWriterBinding& binding) {
  return "{\"schemaVersion\":1,\"drawingId\":" +
         jsonString(binding.drawingId) + ",\"sourceFingerprint\":" +
         jsonString(binding.sourceFingerprint) + ",\"modelEpoch\":" +
         jsonString(binding.modelEpoch) + ",\"writerSessionId\":" +
         jsonString(binding.writerSessionId) + ",\"baseRevision\":0}\n";
}

std::string payloadFileName(OutboxArtifactKind kind) {
  switch (kind) {
    case OutboxArtifactKind::Delta:
      return "payload.cadwebdelta";
    case OutboxArtifactKind::Snapshot:
      return "payload.cadweb";
  }
  throw std::runtime_error("outbox artifact kind is invalid");
}

std::string itemJson(const OutboxItem& item, const std::string& fileName) {
  return "{\"schemaVersion\":1,\"artifactKind\":" +
         jsonString(outboxArtifactKindName(item.artifactKind)) +
         ",\"artifactId\":" + jsonString(item.artifactId) +
         ",\"saveToken\":" + jsonString(item.saveToken) +
         ",\"drawingId\":" + jsonString(item.drawingId) +
         ",\"modelEpoch\":" + jsonString(item.modelEpoch) +
         ",\"writerSessionId\":" + jsonString(item.writerSessionId) +
         ",\"baseRevision\":" + std::to_string(item.baseRevision) +
         ",\"resultStateHash\":" + jsonString(item.resultStateHash) +
         ",\"payload\":{\"fileName\":" + jsonString(fileName) +
         ",\"size\":" + std::to_string(item.payloadSize) +
         ",\"sha256\":" + jsonString(item.payloadSha256) + "}}\n";
}

bool hasReadySuffix(const std::filesystem::path& path) {
  const auto name = path.filename().string();
  return name.size() > 6U && name.substr(name.size() - 6U) == ".ready";
}

}  // namespace

CadWebDurableStore::CadWebDurableStore(std::filesystem::path root,
                                       DurableOutboxLimits limits)
    : root_(std::move(root)), limits_(limits) {
  require(!root_.empty(), "durable store root is required");
  require(limits_.maxReadyItems != 0U && limits_.maxPayloadBytes != 0U &&
              limits_.maxPayloadBytes <= limits::kMaxArchiveBytes &&
              limits_.maxTotalReadyBytes >= limits_.maxPayloadBytes,
          "durable outbox limits are invalid");
}

std::filesystem::path CadWebDurableStore::bindingPath(
    const std::string& sourceFingerprint) const {
  return root_ / "bindings" /
         (fingerprintStorageKey(sourceFingerprint) + ".json");
}

std::filesystem::path CadWebDurableStore::statePath(
    const std::string& sourceFingerprint) const {
  return root_ / "state" /
         (fingerprintStorageKey(sourceFingerprint) + ".cwsj");
}

void CadWebDurableStore::writeProvisionedBindingAtomically(
    const ProvisionedWriterBinding& binding) const {
  validateBinding(binding);
  writeTextAtomically(bindingPath(binding.sourceFingerprint),
                      bindingJson(binding));
}

std::optional<ProvisionedWriterBinding>
CadWebDurableStore::loadProvisionedBinding(
    const std::string& sourceFingerprint) const {
  const auto path = bindingPath(sourceFingerprint);
  std::error_code error;
  if (!std::filesystem::exists(path, error)) {
    require(!error, "cannot inspect writer binding path");
    return std::nullopt;
  }
  const auto json = readTextFile(path);
  require(parseJsonUintField(json, "schemaVersion") == 1U &&
              parseJsonUintField(json, "baseRevision") == 0U,
          "writer binding version/base revision is unsupported");
  ProvisionedWriterBinding binding;
  binding.drawingId = parseJsonStringField(json, "drawingId");
  binding.sourceFingerprint =
      parseJsonStringField(json, "sourceFingerprint");
  binding.modelEpoch = parseJsonStringField(json, "modelEpoch");
  binding.writerSessionId = parseJsonStringField(json, "writerSessionId");
  validateBinding(binding);
  require(fingerprintStorageKey(binding.sourceFingerprint) ==
              fingerprintStorageKey(sourceFingerprint),
          "writer binding source fingerprint does not match its file");
  return binding;
}

void CadWebDurableStore::saveDocumentStateAtomically(
    const DurableDocumentSyncState& state) const {
  validateDocumentState(state);
  writeFileAtomically(statePath(state.binding.sourceFingerprint),
                      encodeDocumentState(state));
}

std::optional<DurableDocumentSyncState>
CadWebDurableStore::loadDocumentState(
    const std::string& sourceFingerprint) const {
  const auto path = statePath(sourceFingerprint);
  std::error_code error;
  if (!std::filesystem::exists(path, error)) {
    require(!error, "cannot inspect durable document state path");
    return std::nullopt;
  }
  auto state = decodeDocumentState(readFile(path, kMaxStateBytes));
  validateDocumentState(state);
  require(fingerprintStorageKey(state.binding.sourceFingerprint) ==
              fingerprintStorageKey(sourceFingerprint),
          "durable document state source fingerprint does not match its file");
  return state;
}

std::vector<std::filesystem::path>
CadWebDurableStore::listReadyItemDirectories() const {
  const auto itemsRoot = root_ / "outbox" / "items";
  std::error_code error;
  if (!std::filesystem::exists(itemsRoot, error)) {
    require(!error, "cannot inspect durable outbox directory");
    return {};
  }
  std::vector<std::filesystem::path> result;
  for (std::filesystem::directory_iterator iterator(itemsRoot, error), end;
       !error && iterator != end; iterator.increment(error)) {
    if (iterator->is_directory(error) && !error &&
        hasReadySuffix(iterator->path())) {
      result.push_back(iterator->path());
    }
  }
  require(!error, "cannot enumerate durable outbox directory");
  std::sort(result.begin(), result.end());
  return result;
}

OutboxItem CadWebDurableStore::prepareOutboxItem(
    OutboxItem item, const std::filesystem::path& preparedPayload) const {
  require(isPathIdentifier(item.artifactId),
          "outbox artifact ID is not path-safe");
  require(!item.saveToken.empty() && !item.drawingId.empty() &&
              !item.modelEpoch.empty() && !item.writerSessionId.empty(),
          "outbox item identity is incomplete");
  require(isLowerHexDigest(item.resultStateHash),
          "outbox result state hash is invalid");
  if (item.artifactKind == OutboxArtifactKind::Delta) {
    require(item.baseRevision != 0U,
            "delta outbox item requires a positive base revision");
  }
  const auto fixedPayloadName = payloadFileName(item.artifactKind);
  std::error_code error;
  require(std::filesystem::is_regular_file(preparedPayload, error) && !error,
          "prepared outbox payload is not a regular file");
  const auto actualSize = std::filesystem::file_size(preparedPayload, error);
  require(!error && actualSize != 0U &&
              actualSize <= limits_.maxPayloadBytes,
          "prepared outbox payload exceeds its size limit");
  const auto payloadBytes = readFile(preparedPayload, limits_.maxPayloadBytes);
  const auto actualSha256 = detail::sha256Hex(payloadBytes);
  if (item.payloadSize == 0U) item.payloadSize = actualSize;
  if (item.payloadSha256.empty()) item.payloadSha256 = actualSha256;
  require(item.payloadSize == actualSize &&
              item.payloadSha256 == actualSha256,
          "prepared outbox payload size/SHA-256 does not match metadata");

  const auto itemsRoot = root_ / "outbox" / "items";
  std::filesystem::create_directories(itemsRoot, error);
  require(!error, "cannot create durable outbox directory");
  const auto ready = itemsRoot / (item.artifactId + ".ready");
  const auto staged = itemsRoot / (item.artifactId + ".staged");
  const auto manifest = itemJson(item, fixedPayloadName);
  if (std::filesystem::exists(ready, error)) {
    require(!error && std::filesystem::is_directory(ready),
            "ready outbox path is not a directory");
    const auto readyPayload = ready / fixedPayloadName;
    require(readTextFile(ready / "item.json") == manifest &&
                std::filesystem::file_size(readyPayload, error) == actualSize &&
                !error &&
                detail::sha256Hex(
                    readFile(readyPayload, limits_.maxPayloadBytes)) ==
                    actualSha256,
            "outbox artifact ID was reused with different content");
    item.payloadPath = readyPayload.string();
    item.payloadIsDurable = true;
    return item;
  }
  require(!error, "cannot inspect ready outbox path");

  if (std::filesystem::exists(staged, error)) {
    require(!error && std::filesystem::is_directory(staged),
            "staged outbox path is not a directory");
    const auto stagedPayload = staged / fixedPayloadName;
    require(readTextFile(staged / "item.json") == manifest &&
                std::filesystem::file_size(stagedPayload, error) == actualSize &&
                !error &&
                detail::sha256Hex(
                    readFile(stagedPayload, limits_.maxPayloadBytes)) ==
                    actualSha256,
            "outbox artifact ID was reused with different staged content");
    item.payloadPath = (ready / fixedPayloadName).string();
    item.payloadIsDurable = true;
    return item;
  }
  require(!error, "cannot inspect staged outbox path");

  const auto readyItems = listReadyItemDirectories();
  std::size_t stagedCount = 0U;
  std::uint64_t totalBytes = 0U;
  for (std::filesystem::directory_iterator iterator(itemsRoot, error), end;
       !error && iterator != end; iterator.increment(error)) {
    const auto name = iterator->path().filename().string();
    if (iterator->is_directory(error) && !error && name.size() > 7U &&
        name.substr(name.size() - 7U) == ".staged") {
      ++stagedCount;
      for (const auto& fileName : {"payload.cadwebdelta", "payload.cadweb"}) {
        const auto candidate = iterator->path() / fileName;
        if (std::filesystem::is_regular_file(candidate, error) && !error) {
          const auto size = std::filesystem::file_size(candidate, error);
          require(!error &&
                      totalBytes <=
                          std::numeric_limits<std::uint64_t>::max() - size,
                  "durable outbox byte count overflowed");
          totalBytes += size;
        } else {
          error.clear();
        }
      }
    }
  }
  require(!error, "cannot enumerate staged outbox directory");
  require(readyItems.size() + stagedCount < limits_.maxReadyItems,
          "durable outbox item quota is full");
  for (const auto& directory : readyItems) {
    for (const auto& fileName : {"payload.cadwebdelta", "payload.cadweb"}) {
      const auto candidate = directory / fileName;
      if (std::filesystem::is_regular_file(candidate, error) && !error) {
        const auto size = std::filesystem::file_size(candidate, error);
        require(!error &&
                    totalBytes <=
                        std::numeric_limits<std::uint64_t>::max() - size,
                "durable outbox byte count overflowed");
        totalBytes += size;
      } else {
        error.clear();
      }
    }
  }
  require(totalBytes <= limits_.maxTotalReadyBytes - actualSize,
          "durable outbox byte quota is full");

  const auto preparing = temporarySibling(
      itemsRoot / (item.artifactId + ".preparing"), "-");
  try {
    std::filesystem::create_directory(preparing, error);
    require(!error, "cannot create outbox staging directory");
    const auto stagedPayload = preparing / fixedPayloadName;
    std::filesystem::copy_file(preparedPayload, stagedPayload,
                               std::filesystem::copy_options::none, error);
    require(!error, "cannot copy package into outbox staging directory");
    syncFile(stagedPayload);
    writeTextAtomically(preparing / "item.json", manifest);
    syncDirectory(preparing);
    renameDirectoryAtomically(preparing, staged);
    syncDirectory(itemsRoot);
  } catch (...) {
    std::filesystem::remove_all(preparing, error);
    throw;
  }

  item.payloadPath = (ready / fixedPayloadName).string();
  item.payloadIsDurable = true;
  return item;
}

SealedOutboxItem CadWebDurableStore::publishPreparedOutboxItem(
    const OutboxItem& item) const {
  require(isPathIdentifier(item.artifactId) && item.payloadIsDurable,
          "prepared outbox item identity is invalid");
  const auto fixedPayloadName = payloadFileName(item.artifactKind);
  const auto itemsRoot = root_ / "outbox" / "items";
  const auto staged = itemsRoot / (item.artifactId + ".staged");
  const auto ready = itemsRoot / (item.artifactId + ".ready");
  const auto manifest = itemJson(item, fixedPayloadName);
  std::error_code error;
  if (std::filesystem::exists(ready, error)) {
    require(!error && std::filesystem::is_directory(ready) &&
                readTextFile(ready / "item.json") == manifest,
            "ready outbox item does not match its durable journal");
  } else {
    require(!error && std::filesystem::is_directory(staged, error) && !error &&
                readTextFile(staged / "item.json") == manifest,
            "durable journal has no matching staged outbox item");
    renameDirectoryAtomically(staged, ready);
    syncDirectory(itemsRoot);
  }
  const auto readyPayload = ready / fixedPayloadName;
  require(std::filesystem::file_size(readyPayload, error) == item.payloadSize &&
              !error &&
              detail::sha256Hex(
                  readFile(readyPayload, limits_.maxPayloadBytes)) ==
                  item.payloadSha256,
          "ready outbox payload does not match its durable journal");
  OutboxItem readyItem = item;
  readyItem.payloadPath = readyPayload.string();
  return {std::move(readyItem), ready, ready / "item.json", readyPayload};
}

std::optional<DurableAcknowledgement>
CadWebDurableStore::readAcknowledgement(const OutboxItem& item) const {
  require(isPathIdentifier(item.artifactId),
          "outbox artifact ID is not path-safe");
  const auto path = root_ / "outbox" / "items" /
                    (item.artifactId + ".ready") / "ack.json";
  std::error_code error;
  if (!std::filesystem::exists(path, error)) {
    require(!error, "cannot inspect outbox acknowledgement path");
    return std::nullopt;
  }
  const auto json = readTextFile(path, 64U * 1024U);
  require(parseJsonUintField(json, "schemaVersion") == 1U,
          "outbox acknowledgement version is unsupported");
  DurableAcknowledgement acknowledgement;
  acknowledgement.artifactId = parseJsonStringField(json, "artifactId");
  acknowledgement.saveToken = parseJsonStringField(json, "saveToken");
  acknowledgement.revision = parseJsonUintField(json, "revision");
  acknowledgement.stateHash = parseJsonStringField(json, "stateHash");
  const auto acknowledgedAt =
      parseJsonStringField(json, "acknowledgedAt");
  require(acknowledgement.artifactId == item.artifactId &&
              acknowledgement.saveToken == item.saveToken &&
              item.baseRevision < kMaxJsonSafeInteger &&
              acknowledgement.revision == item.baseRevision + 1U &&
              acknowledgement.stateHash == item.resultStateHash &&
              !acknowledgedAt.empty(),
          "outbox acknowledgement does not match its immutable item");
  return acknowledgement;
}

void CadWebDurableStore::removeAcknowledgedOutboxItem(
    const OutboxItem& item) const {
  require(isPathIdentifier(item.artifactId) && item.acknowledged,
          "only a durably acknowledged outbox item may be removed");
  const auto itemsRoot = root_ / "outbox" / "items";
  std::error_code error;
  for (const auto& suffix : {".ready", ".staged"}) {
    const auto target = itemsRoot / (item.artifactId + suffix);
    if (!std::filesystem::exists(target, error)) {
      require(!error, "cannot inspect acknowledged outbox item");
      continue;
    }
    require(std::filesystem::is_directory(target, error) && !error,
            "acknowledged outbox path is not a directory");
    std::filesystem::remove_all(target, error);
    require(!error, "cannot remove acknowledged outbox item");
  }
  if (std::filesystem::exists(itemsRoot, error) && !error) {
    syncDirectory(itemsRoot);
  }
  require(!error, "cannot flush acknowledged outbox cleanup");
}

}  // namespace cadweb
