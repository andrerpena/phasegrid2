#pragma once
#include <cstdint>
#include <map>
#include <vector>

namespace pg {

class Engine;
class TelemetryWriter;

/// Samples in a published picture: the count a face asks for, and more than a panel can show.
inline constexpr uint32_t kPreviewFrames = 128;

/**
 * Keeps every watched module's picture current.
 *
 * A face shows what its module would play for the values the module is running with, and those
 * values move: a knob under a hand, a modulation cable, a smoother still ramping. The audio thread
 * leaves them on the instance (`ModuleInstance::liveValues`); this reads them on the message thread,
 * asks the module for its picture when they have changed, and writes it into the module's preview
 * slot for the interface to draw at frame rate. Ticked from the command loop, about thirty times a
 * second; a patch where nothing moves costs a comparison per module and no drawing.
 *
 * Message thread only, like `Module::preview` itself: it may allocate, and it never touches the
 * audio thread's state beyond those relaxed reads.
 */
class PreviewPublisher {
public:
  PreviewPublisher(Engine& engine, TelemetryWriter& writer);
  /// One pass over the instances with a preview slot.
  void tick();
  uint64_t published() const { return index_; }

private:
  Engine& engine_;
  TelemetryWriter& writer_;
  std::vector<float> samples_;
  /// What each instance (by serial) was last drawn with, and into which slot, so an unchanged module
  /// is not redrawn -- unless a resubscription has moved it, and the slot it now owns holds someone
  /// else's picture until it is drawn again.
  struct Drawn {
    uint32_t slot;
    std::vector<float> values;
  };
  std::map<uint64_t, Drawn> lastDrawn_;
  uint64_t index_ = 0;
};

}  // namespace pg
