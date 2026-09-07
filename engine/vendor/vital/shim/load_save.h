#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include "JuceHeader.h"
#include "json/json.h"
#include "utils.h"

class LoadSave {
public:
  static int compareVersionStrings(String a, String b) { return compare(a.toStdString(), b.toStdString()); }

  static void convertBufferToPcm(json& data, const std::string& field) {
    if (data.count(field) == 0) return;
    MemoryOutputStream decoded; Base64::convertFromBase64(decoded, data[field].get<std::string>());
    const int size = static_cast<int>(decoded.getDataSize() / sizeof(float));
    std::unique_ptr<float[]> f(new float[size]); std::memcpy(f.get(), decoded.getData(), size * sizeof(float));
    std::unique_ptr<int16_t[]> pcm(new int16_t[size]); vital::utils::floatToPcmData(pcm.get(), f.get(), size);
    data[field] = Base64::toBase64(pcm.get(), sizeof(int16_t) * size).toStdString();
  }
  static void convertPcmToFloatBuffer(json& data, const std::string& field) {
    if (data.count(field) == 0) return;
    MemoryOutputStream decoded; Base64::convertFromBase64(decoded, data[field].get<std::string>());
    const int size = static_cast<int>(decoded.getDataSize() / sizeof(int16_t));
    std::unique_ptr<int16_t[]> pcm(new int16_t[size]); std::memcpy(pcm.get(), decoded.getData(), size * sizeof(int16_t));
    std::unique_ptr<float[]> f(new float[size]); vital::utils::pcmToFloatData(f.get(), pcm.get(), size);
    data[field] = Base64::toBase64(f.get(), sizeof(float) * size).toStdString();
  }

private:
  static int compare(std::string a, std::string b) {   // "0.3.7" style, recursive on the first component
    auto trim = [](std::string& s) { while (!s.empty() && isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
                                     while (!s.empty() && isspace(static_cast<unsigned char>(s.front()))) s.erase(0, 1); };
    trim(a); trim(b);
    if (a.empty() && b.empty()) return 0;
    auto head = [](const std::string& s) { const auto d = s.find('.'); return d == std::string::npos ? s : s.substr(0, d); };
    auto tail = [](const std::string& s) { const auto d = s.find('.'); return d == std::string::npos ? std::string() : s.substr(d + 1); };
    auto num = [](const std::string& s) { return s.empty() || s.find_first_not_of("0123456789") != std::string::npos ? 0 : std::stoi(s); };
    const int x = num(head(a)), y = num(head(b));
    if (x != y) return x > y ? 1 : -1;
    return compare(tail(a), tail(b));
  }
};
