# 0006. The output clips like the reference instrument's, and says so

2026-09-10. Accepted. Follows [0005](0005-the-transport-ticks-per-engine-block.md).

## Context

With the clock fixed, the sine patch was clean and the same patch with a Chord in front of it was
rough again. Measured through the device path:

| | gain 1 | gain 0.3 |
|---|---|---|
| peak | **2.994** | 0.898 |
| samples over full scale | **33.9%** | 0 |
| after the device's clamp at ±1 | crest 1.27, h2 −37.6 dB | crest 2.43, THD 0.00% |

Three full-scale sines sum to three and the converter cuts at one. The voices, the clock and the
oscillator were all correct; the float pipeline carried 2.994 faithfully to the driver, the driver
squared it off, and nothing in the engine or the tools said so. 0005 made the offline render honest
about the live path, and this was the first thing it showed happening *after* the engine.

The reference instrument's Audio Out, from its own inspector: **Output Clipping Mode Off/Hard/Soft,
default Hard; Output Clipping Level 0/+6/+12/+24 dB, default +6; and under Affect Voice Lifetime a
Silence Threshold −144..0 dB, default −96, and a Hold Time 0..1 s, default 50 ms.** Ours had the
lifetime toggle with a fixed −80 dB floor and no hold; 0002 had removed the three-block tail on
purpose, which was right for the reason then. Rack's Audio module (`src/core/Audio.cpp`) hard-clamps
at ±1 at the device boundary and holds a clip light for a quarter of a second.

## Decision

**`io.audioOut` takes the reference instrument's parameters, defaults included.** `clip` Off/Hard/Soft
(Hard), `clipLevel` 0/+6/+12/+24 dB (+6), applied to each pair's gained sum before it reaches the bus:
Hard clamps at the level, Soft is a tanh knee that reaches it asymptotically. Under `lifetime`,
`silence` (−96 dB) and `hold` (50 ms): a voice heard above the threshold is held, and so is one heard
within the hold time before. `voices.sum` takes the lifetime half. The fixed `kVoiceSilence` is gone.

**The output wears a meter with a clip light.** Audio Out publishes the same `Meter` telemetry
`display.meter` does -- held peak, RMS, and a clip flag held for 1.5 s -- of what it actually sent, so
the face shows the level and lights when a sample went over. The renderer needed no change: it already
watches any module whose catalogue entry publishes a meter.

**The device boundary always clamps, and counts.** `Engine::renderBlock`'s fold clamps to ±1 after the
master gain and adds what it clamped to `deviceClips`, exposed in `engine.stats` and in `patch.render`
and printed by `--render`. Nothing above full scale reaches the driver; when the module's own clipping
was Off or its level too high, the number says so where no meter is being watched.

**The tools see clipping.** `audio-measure` reports samples over full scale and, for a hot file, the
crest and THD of the clamped signal, because that is the distortion in the room. `compare-reference`
tabulates it; the `chord-headroom` scenario captures the triad and checks the clamp is counted, the
light is lit, and 0.3 cures it; `live-capture` asserts the sine never clamped.

## Consequences

- **A unity triad still clips at the defaults, and now everyone can see it.** Hard at +6 dB clamps 3.0
  to 2.0 and the converter clamps that to 1.0; the module's meter lights and the count is non-zero.
  That is Bitwig's behaviour too, parameter for parameter. What differs is level: the user's
  single-sine Bitwig export peaked at 0.316, and at that gain our triad peaks at 0.946 with no
  clamp. So the open question is a **level convention** -- where an oscillator sits by default -- not
  a defect, and `fixtures/reference/notefx.chord/triad/` exists to settle it with a Bitwig export of
  the same patch rather than a guess.
- **A voice can outlive its note by the hold time when an exit is asked to hold it**, which is what the
  reference does and what 0002's three blocks were a smaller version of. Off by default.
- **Two engine tests moved below full scale**: a block counter through the sink and a chord of constant
  voices were asserting sums above one that the boundary now clamps. They assert the same facts at a
  tenth of the level.
- **What this does not decide.** The level convention above. `clipLevel` above 0 dB only matters into a
  bus with headroom, which is where Bitwig's Audio Out feeds and ours does not; the parameter is kept
  for fidelity and the boundary clamp makes it safe.
