# Adding a module

1. Create `engine/src/modules/<Name>.cpp`: static C-layout port/param arrays, a class deriving `VoicedModule<State>` with all
   mutable state in `State`, and `const ModuleDescriptor k<Name>` in namespace `pg::modules`.
2. Declare its face (below), or pass `nullptr, 0` to get one composed from its ports and primary params.
3. Add `&modules::k<Name>` to the list in `engine/src/modules/builtin.cpp` (plus an `extern` line).
4. `npm run engine:test`. Add a null test (silence in → silence out) and, for oscillators, a spectral test.
5. No TypeScript changes: the catalog is generated from the descriptor, and the canvas draws the face from the catalog.

Signals are `Sample` (poly_float) frames: write the same value to all lanes for mono, use `lanes::left()/right()` masks for stereo.

## Template

```cpp
#include "core/Module.hpp"
namespace pg::modules {
namespace {
const PortDesc kIn[]  = {{"in", "In", PortKind::Continuous, 1, SignalRole::Any, ""}};
const PortDesc kOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
const ParamDesc kParams[] = {{"amount", "Amount", 0.f, 1.f, 0.5f, ParamUnit::None, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""}};
const char* const kFace[] = {"in amount amount out", ". amount amount ."};
struct State { Sample z = Sample(0.f); };
class Example final : public VoicedModule<State> {
  void process(ProcessContext& c) override {
    State& s = st(c);
    const Sample* in = c.in(0).readOr();
    Sample* out = c.out(0).data; const ParamView amt = c.param(0);
    for (uint32_t i = 0; i < c.numFrames; ++i) { s.z += amt.at(i) * (in[i] - s.z); out[i] = s.z; }
  }
};
}  // namespace
extern const ModuleDescriptor kExample{kModuleAbiVersion, "fx.example", "Example", "fx", "One-pole smoother.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), 0, 0, [] () -> Module* { return new Example(); },
  kFace, countOf(kFace)};
}  // namespace pg::modules
```

Rules: no statics for state, no allocation in `process`, params are numeric only, `numFrames` can be 1 (feedback clusters).
Unconnected continuous inputs are empty `SignalView`s; read through `readOr()`.

## The face

On the canvas a module is a rectangle of cells (24 px each) and its face is a composition of **blocks** -- a jack, a
knob, a wave panel -- each covering a whole number of them, the way a hardware panel is a grid of tiles. Which blocks
and where is the module's own knowledge, so the descriptor says, in rows of tokens in the manner of CSS
`grid-template-areas`: one token per cell, equal neighbours forming one rectangular block. The interface adds a title
row above and draws each block; there is no per-module code anywhere in the interface.

```cpp
// osc.sine: three jacks down the left, the wave, the Fold knob, the output.
const char* const kFace[] = {
  "reset wave wave wave fold fold out",
  "phase wave wave wave fold fold .  ",
  "pitch .    .    .    .    .    .  ",
};
```

| Token | Block |
| --- | --- |
| `.` | an empty cell |
| a port id (`in:<id>` / `out:<id>` when the two sides share a name) | a jack, one cell; every declared port must appear once |
| a param id (`param:<id>` when it collides with a port id) | a knob, at least two cells by two; a larger block scales it up |
| `wave` | the wave panel, at least two by two, on a module that `kModulePreviewsWave` |
| `scope` | the scope screen, at least two by two, on a module that `kModulePublishesScope`; it draws the window the module writes into its telemetry slot |
| `value` | the readout, at least two cells across, on a module that `kModulePublishesValue`; it prints the value the module writes into its telemetry slot |
| `meter` | the level meter, at least two by two, on a module that `kModulePublishesMeter`; it draws the level the module writes into its telemetry slot |
| `piano` | the keyboard, at least four cells across by two, on a module that `kModulePublishesKeys`; it lights the keys the module writes into its telemetry slot |

A module runs once per block when it is global and once per live voice pair when it is inside an instrument;
`ctx.firstPass` and `ctx.lastPass` say where a pass sits, `ctx.voiceMask` which lanes carry a voice, and
`ctx.activity` is the instrument's pool or null. Per-block work goes on the first pass, a fold clears on the
first and publishes on the last. `kModuleVoiceEntry` marks a module that starts an instrument (it implements
`Module::allocate` and has a `voices` param); `kModuleVoiceExit` one that folds the voices to a global signal.
A module that knows a voice is still going after its note off -- an envelope in its release, an exit that
still hears it -- says so each pass through `ctx.activity->hold(voice)`; a released voice nobody holds is
free at the end of the block. See the instruments section of docs/engine.md.

Implicit modulation ports (`param:<id>`) never appear: the socket for one sits at its knob's foot, and a cable dropped
on the knob connects to it. A jack in the leftmost or rightmost column sits its socket on the module's border; one on
the bottom row sits it on the bottom border; anywhere else the socket is the cell's centre. Short rows are padded
with `.`. Hidden and enum params have no block yet.

`Registry::add` rejects a face that names nothing, leaves a port out, names something twice, gives a knob, the wave,
the scope, the readout or the meter too little room, or has a non-rectangular block -- so a wrong face is a module that does not register rather than a
node drawn wrong. `face = nullptr, faceRows = 0` is a module with no declared face: the interface composes one from
its ports (down the sides) and its `kParamPrimary` params (knobs between them, the scope, the wave, the readout and the meter first). A vendored module
declares its rows in `ModuleSpec::faceRows`, naming controls by suffix.

## Wrapping a vendored module

A module built on the vendored DSP (`engine/vendor/vital`) has no class of its own. It is one `ModuleSpec` value in a
single `.cpp` under `engine/src/modules/vital`, handed to `buildDescriptor`, plus one line in `builtin.cpp`. There is
still no TypeScript change: the descriptor — ranges, units, enum labels and all — is generated from the vendored
parameter table at registry time, and `--catalog` publishes it.

```cpp
const ModuleDescriptor& myModule() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec;
    spec.id = "cat.thing";  spec.name = "Thing";  spec.category = "cat";  spec.doc = "...";
    spec.prefix = "thing_1";                                  // control names are prefix + "_" + suffix
    spec.create = [](vendor::ModuleContext&) { return vendor::makeModule<vital::ThingModule>("thing_1"); };
    spec.inputs  = {{"in", "In", vital::ThingModule::kAudio, vendor::BindKind::Audio, SignalRole::Audio, "..."}};
    spec.outputs = {{"out", "Out", vital::ThingModule::kOut, SignalRole::Audio, "..."}};
    spec.hidden  = {"on"};
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}
```

Checklist, every item of which has already been a bug:

- **`makeModule<T>`, never `new T`.** It wraps the type so the vendored router actually runs its *sorted* order; a
  bare `new` makes a module that plugs a processor before creating its controls read them a block late, and read
  zero on the first block. See docs/engine.md.
- **`prefix` even when the vendored module hard-codes its names.** The sample player calls its controls `sample_*`
  rather than taking a prefix argument, but `prefix = "sample"` is still what turns them into `level` and `loop`
  instead of `sample_level` and `sample_loop`.
- **Check each exposed output against the vendored `process()`.** Some fill a full-size Output but only ever write
  `buffer[0]`; those need `OutputMap::firstFrameOnly`. `Output::isControlRate()` does not catch them.
- **Check every `kIndexed` control's name table length against its own range.** When the names depend on a second
  control the table is shorter, and generating labels reads off its end; set `ControlOverride::suppressLabels` and
  document the control as a plain integer.
- **`hidden` only matches controls the module actually creates**, and it is load-bearing: an exposed control the
  module needs held at a non-default value (`sample_on`) gets the descriptor default written back over it every
  block. Check `getControls()` after `init()`, not the parameter table.
- **`kMaxPortsPerModule` is 32**, counted as declared inputs + *all* params (`osc.wavetable` is at 31).
- **Test with a settled source, not an impulse in block 0**: every effect ramps its wet/dry mix, and the filters
  their coefficients, up from zero across the first block they see.
- **Give it an `[rt]` test that first asserts the graph is producing output**, so it cannot pass by measuring silence.
