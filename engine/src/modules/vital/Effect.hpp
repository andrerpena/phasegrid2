#pragma once
#include "vital/Descriptors.hpp"

namespace pg::modules {

/// The shape every vendored effect shares: audio in, audio out, always on.
///
/// The vendored effects take their audio through `processWithInput` rather than through a plugged input, so
/// the `in` port has no vendored input index (-1) and the adapter hands the block straight to
/// `processWithInput`. None of them creates the `<name>_on` control the host synth uses to bypass them -- that
/// switch lives in the host, not the module -- so there is no `on` param to hide: on the grid, bypassing an
/// effect means unplugging it.
inline vendor::ModuleSpec effectSpec(const char* id, const char* name, const char* doc, const char* prefix,
                                     const char* outDoc) {
  vendor::ModuleSpec spec;
  spec.id = id;
  spec.name = name;
  spec.category = "Audio FX";
  spec.doc = doc;
  spec.prefix = prefix;
  spec.processWithInput = true;
  spec.inputs = {{"in", "In", -1, vendor::BindKind::Audio, SignalRole::Audio, "Audio input"}};
  spec.outputs = {{"out", "Out", 0, SignalRole::Audio, outDoc}};
  return spec;
}

}  // namespace pg::modules
