#pragma once
#include <cstdint>
#include <string_view>

#include "core/Descriptor.hpp"

namespace pg {

/**
 * What a module publishes, as opposed to what the bytes are.
 *
 * `TelemetryKind` (`services/Telemetry.hpp`) says what a slot CONTAINS -- a meter, a scope, a set of
 * parameter values. A channel says who writes it and why, and a module may hold several at once: a
 * pattern draws its own piano roll AND has knobs that modulation turns, and those are two different
 * publishers writing two different kinds. One slot each, so neither can overwrite the other.
 *
 * A subscription is a set of (module, channel) pairs; `telemetry.subscribe` hands each pair a slot and
 * the reply is the only place that mapping exists. Adding a channel is a name here, a serving rule in
 * `moduleServes`, and a writer -- not another list on the wire.
 */
enum class TelemetryChannel : uint32_t {
  /// The effective value of every parameter after modulation, written by the scheduler after the
  /// module's `process`. It is what lets a knob on the interface turn when something is plugged in.
  Params = 0,
  /// What the module publishes about itself onto its own face -- a meter's level, a scope's window, a
  /// readout's value, a note source's notes. Written by the module, on the audio thread.
  Display = 1,
  /// One cycle of the picture a module would draw for the values it is running with, written by
  /// `PreviewPublisher` on the message thread.
  Preview = 2,
};
inline constexpr uint32_t kTelemetryChannelCount = 3;

/// "nobody is watching this module on this channel". Not a valid slot index, and the default for every
/// channel of every instance. `services/Telemetry.hpp` spells the same value `kNoTelemetrySlot`, for
/// readers of the segment; core must not depend on the segment's layout to say "no".
inline constexpr uint32_t kNoTelemetrySlotCtx = 0xFFFFFFFFu;

/// Iteration order for anything that has to touch every channel. Ranged-for over the array beats a
/// loop to `kTelemetryChannelCount` with a cast, and a new channel is one entry rather than an audit.
inline constexpr TelemetryChannel kTelemetryChannels[kTelemetryChannelCount] = {
    TelemetryChannel::Params, TelemetryChannel::Display, TelemetryChannel::Preview};

inline constexpr uint32_t channelIndex(TelemetryChannel c) { return static_cast<uint32_t>(c); }

/// The name on the wire. `telemetry.subscribe` speaks these and nothing else.
inline constexpr const char* telemetryChannelName(TelemetryChannel c) {
  switch (c) {
    case TelemetryChannel::Params: return "params";
    case TelemetryChannel::Display: return "display";
    case TelemetryChannel::Preview: return "preview";
  }
  return "";
}

/// The wire name back to a channel; false for anything else, which is a schema error rather than a
/// channel nobody is subscribed to.
inline bool telemetryChannelFromName(std::string_view name, TelemetryChannel& out) {
  for (TelemetryChannel c : kTelemetryChannels) {
    if (name == telemetryChannelName(c)) { out = c; return true; }
  }
  return false;
}

/// Whether this kind of module has anything to publish on this channel. The one table: a subscription
/// naming a channel a module cannot serve is refused here rather than accepted and silently empty.
inline bool moduleServes(const ModuleDescriptor& d, TelemetryChannel c) {
  switch (c) {
    case TelemetryChannel::Params: return d.numParams > 0;
    case TelemetryChannel::Display: return (d.flags & kModuleWritesTelemetry) != 0;
    case TelemetryChannel::Preview: return (d.flags & kModulePreviewsWave) != 0;
  }
  return false;
}

}  // namespace pg
