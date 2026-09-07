#pragma once
// phasegrid2 shim that replaces JUCE for the vendored Vital DSP. Vital's engine uses JUCE only for
// leak-detector macros, String/MemoryOutputStream/Base64 in JSON (de)serializers, and ProjectInfo.
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#define JUCE_LEAK_DETECTOR(x)
#define JUCE_DECLARE_NON_COPYABLE(x)
#define JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(x)

class String {
public:
  String() = default;
  String(const char* s) : s_(s ? s : "") {}
  String(std::string s) : s_(std::move(s)) {}
  const std::string& toStdString() const { return s_; }
  bool isEmpty() const { return s_.empty(); }
  const char* toRawUTF8() const { return s_.c_str(); }
private:
  std::string s_;
};

class MemoryOutputStream {
public:
  explicit MemoryOutputStream(size_t reserveBytes = 0) { data_.reserve(reserveBytes); }
  void write(const void* p, size_t n) { const auto* b = static_cast<const uint8_t*>(p); data_.insert(data_.end(), b, b + n); }
  const void* getData() const { return data_.data(); }
  size_t getDataSize() const { return data_.size(); }
private:
  std::vector<uint8_t> data_;
};

struct Base64 {
  static String toBase64(const void* data, size_t bytes) {
    static const char* k = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const auto* in = static_cast<const uint8_t*>(data);
    std::string out; out.reserve((bytes + 2) / 3 * 4);
    for (size_t i = 0; i < bytes; i += 3) {
      const uint32_t n = (uint32_t(in[i]) << 16) | (i + 1 < bytes ? uint32_t(in[i + 1]) << 8 : 0) | (i + 2 < bytes ? uint32_t(in[i + 2]) : 0);
      out.push_back(k[(n >> 18) & 63]); out.push_back(k[(n >> 12) & 63]);
      out.push_back(i + 1 < bytes ? k[(n >> 6) & 63] : '='); out.push_back(i + 2 < bytes ? k[n & 63] : '=');
    }
    return String(std::move(out));
  }
  static bool convertFromBase64(MemoryOutputStream& out, const std::string& text) {
    auto val = [](char c) -> int {
      if (c >= 'A' && c <= 'Z') return c - 'A'; if (c >= 'a' && c <= 'z') return c - 'a' + 26;
      if (c >= '0' && c <= '9') return c - '0' + 52; if (c == '+') return 62; if (c == '/') return 63; return -1; };
    uint32_t acc = 0; int bits = 0;
    for (char c : text) {
      if (c == '=') break;
      const int v = val(c); if (v < 0) continue;
      acc = (acc << 6) | uint32_t(v); bits += 6;
      if (bits >= 8) { bits -= 8; const uint8_t byte = uint8_t((acc >> bits) & 0xFF); out.write(&byte, 1); }
    }
    return true;
  }
};

namespace ProjectInfo { inline constexpr const char* versionString = "phasegrid2"; }
