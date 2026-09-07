#include "compressor_module.h"
#include "modules/vital/Effect.hpp"

namespace pg::modules {

/// fx.compressor -- the vendored multiband compressor: three bands, each with an upper and a lower threshold
/// so it can expand as well as compress, plus the six mean-squared readouts the host meters with.
const ModuleDescriptor& fxCompressor() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec = effectSpec(
      "fx.compressor", "Compressor",
      "Multiband compressor. Each band has an upper threshold that compresses above it and a lower threshold "
      "that expands below it; Enabled Bands chooses how many bands run. Thresholds and gains are in decibels.",
      "compressor", "Dry/wet compressed output");
    spec.create = [](vendor::ModuleContext&) { return vendor::makeModule<vital::CompressorModule>(); };
    // Level readouts, one pair per band. Each is a full-size Output the vendored compressor writes only at
    // buffer[0] -- one mean-squared value per block -- so all six are broadcast rather than copied.
    const struct { const char* id; const char* name; int index; const char* doc; } kMeters[] = {
      {"low_in", "Low In", vital::CompressorModule::kLowInputMeanSquared, "Low band input level, mean squared"},
      {"band_in", "Band In", vital::CompressorModule::kBandInputMeanSquared, "Mid band input level, mean squared"},
      {"high_in", "High In", vital::CompressorModule::kHighInputMeanSquared, "High band input level, mean squared"},
      {"low_out", "Low Out", vital::CompressorModule::kLowOutputMeanSquared, "Low band output level, mean squared"},
      {"band_out", "Band Out", vital::CompressorModule::kBandOutputMeanSquared, "Mid band output level, mean squared"},
      {"high_out", "High Out", vital::CompressorModule::kHighOutputMeanSquared, "High band output level, mean squared"},
    };
    for (const auto& m : kMeters)
      spec.outputs.push_back({m.id, m.name, m.index, SignalRole::Cv, m.doc, /*firstFrameOnly=*/true});
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules
