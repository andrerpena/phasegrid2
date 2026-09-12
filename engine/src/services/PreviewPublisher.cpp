#include "services/PreviewPublisher.hpp"

#include <set>

#include "core/Engine.hpp"
#include "services/Telemetry.hpp"

namespace pg {

PreviewPublisher::PreviewPublisher(Engine& engine, TelemetryWriter& writer)
    : engine_(engine), writer_(writer), samples_(kPreviewFrames, 0.f) {}

void PreviewPublisher::tick() {
  std::set<uint64_t> seen;
  engine_.forEachInstance([&](ModuleInstance& inst) {
    const uint32_t slot = inst.slot(TelemetryChannel::Preview);
    if (slot == kNoTelemetrySlotCtx) return;
    const ModuleDescriptor& d = *inst.type->desc;
    // An envelope draws a picture too; the kind it is published as says how to read it. Its playhead
    // travels while every knob stands still, so it is asked on every tick and the ANSWER decides
    // whether to publish -- a resting envelope still costs one comparison and no write.
    const bool envelope = (d.flags & kModulePreviewsEnvelope) != 0;
    if ((d.flags & kModulePreviewsWave) == 0 && !envelope) return;
    seen.insert(inst.serial);

    // The values the sound is made with, when the module has run under this subscription; the
    // document's until then, so a face is never blank while the first block is on its way -- and
    // again while the patch is held, because nothing is running to have a live value: a face then
    // shows what the patch is SET to, and follows a knob turned in the silence, which is how a
    // patch gets built before anyone presses Play.
    std::vector<float> values(d.numParams);
    if (inst.liveBlock.load(std::memory_order_relaxed) > 0 && engine_.running()) {
      for (uint32_t i = 0; i < d.numParams; ++i) values[i] = inst.liveValues[i].load(std::memory_order_relaxed);
    } else {
      const ParamValues model = engine_.paramValuesFor(inst.id);
      for (uint32_t i = 0; i < d.numParams; ++i) {
        const auto it = model.find(d.params[i].id);
        values[i] = it == model.end() ? d.params[i].def : it->second;
      }
    }
    auto last = lastDrawn_.find(inst.serial);
    const bool sameSlot = last != lastDrawn_.end() && last->second.slot == slot;
    if (!envelope && sameSlot && last->second.values == values) return;

    ParamValues named;
    for (uint32_t i = 0; i < d.numParams; ++i) named[d.params[i].id] = values[i];
    if (!inst.module->preview(named, samples_.data(), kPreviewFrames)) return;
    if (envelope) {
      if (sameSlot && last->second.picture == samples_) return;
      writer_.writeEnvelope(slot, samples_.data(), kPreviewFrames, ++index_);
      lastDrawn_[inst.serial] = Drawn{slot, {}, samples_};
      return;
    }
    writer_.writePreview(slot, samples_.data(), kPreviewFrames, ++index_);
    lastDrawn_[inst.serial] = Drawn{slot, std::move(values), {}};
  });
  // A module that left the patch, or lost its slot, is forgotten so a later instance with the same
  // serial (there is none, serials only grow) or a resubscribed one is drawn afresh.
  for (auto it = lastDrawn_.begin(); it != lastDrawn_.end();)
    it = seen.contains(it->first) ? std::next(it) : lastDrawn_.erase(it);
}

}  // namespace pg
