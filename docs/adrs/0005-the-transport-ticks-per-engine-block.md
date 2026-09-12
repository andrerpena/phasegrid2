# 0005. The transport ticks per engine block, and the live output is capturable

2026-09-10. Accepted. Closes the open item in [0004](0004-a-waveform-is-measured-by-its-shape.md).

## Context

"The sine sounds rough" took four rounds. Rounds one to three each fixed a real defect --
[0002](0002-a-released-voice-lives-only-while-a-module-holds-it.md) voices piling up,
[0003](0003-a-voice-fades-out-and-the-sine-starts-at-zero.md) full-scale clicks,
[0004](0004-a-waveform-is-measured-by-its-shape.md) a Sine that was a soft-clipper -- and each ended
with green tests, clean renders, and the same complaint. All three rounds measured offline renders.
The fault was in the one path none of them exercised.

The device callback advanced the transport **once per callback** (`main.cpp`), producing one snapshot.
`Engine::renderInterleaved` then cut the callback into 64-frame engine blocks through `BlockSplitter`
and handed **the same snapshot to every block**. Every time-driven module derives its position from
`t.ppq` plus the frame index, so the second block of each callback replayed the first block's musical
time. `notes.pattern` saw the playhead go backwards, released everything, and restarted the notes under
it. With a voice pool, that is a fresh voice every 1.3 ms, with the fades from 0003 stacking underneath.
At a 128-frame period that is one replay per callback; the platform may grant 512, which is seven.

| Path | Who advanced the clock | Blocks per advance | Result |
|---|---|---|---|
| device callback | `main.cpp`, once per callback | period / 64 | every note retriggered per block |
| offline render | `OfflineRenderer`, once per block | 1 | clean |
| `patch.render` | the offline path | 1 | clean, and what every scenario measured |

The bug predates the instrument model. A mono converter re-hearing the same note was harmless: same
pitch, nothing on the gate. `note.toPoly` turned every replay into an allocation, which is why it arrived
with polyphony while having nothing to do with it. The e2e application runs the null device at a
128-frame period and has been glitching too, unheard, because nothing recorded the live output.

## Decision

**The engine ticks the clock, once per block, inside `renderInterleaved`.** The signature takes a
`Transport&`, not a snapshot; the splitter callback calls `advance(n)` for each block it renders. The
device callback hands the transport over and advances nothing.

**Offline and live are one path.** `pg::renderInterleaved` drives `Engine::renderInterleaved` with its
own `Transport`, in chunks of `RenderOptions::period`. There is no second path that calls `renderBlock`
with its own idea of time. `--render --period 512` is a render that takes exactly the route a device
callback takes.

**The device period must not change the sound, and a test says so.** `test_render.cpp` renders the
sine pattern at periods 64, 100, 128, 512 and 1024 and requires the output sample-for-sample identical.
Identical, not close: same code, same blocks inside, same clock. Reintroducing the old once-per-callback
advance fails it at the first differing sample.

**A clock discontinuity is an engine error.** `renderBlock` counts every block whose `samplePos` is not
the previous block's plus its frames. Engine time free-runs and never seeks, so the count is a fault in
whoever drives the clock. The command loop says so on stderr once, which the application logs as an
error and the e2e harness fails every scenario on; `engine.stats` exposes the count for a script to
assert zero; `hello` and `engine.ready` report the period the device actually granted.

**The live output is capturable.** `audio.capture.start { path }` arms a ring the device thread copies
every rendered buffer into, a writer thread drains it to a WAV, and `audio.capture.stop` reports frames
written and frames dropped. What a script then measures is the audio a listener gets, not a re-render of
the same patch. The `live-capture` scenario is the first in the project to do so: it records the null
device while a pattern plays a sine and asserts no step, a sine's crest factor, and zero clock faults.

**The comparison tooling the four rounds lacked** now exists: `--render` takes `--tempo`, `--bars`,
`--period` and repeatable `--set module.param=value`; `render:example` renders a built-in example to a
WAV and measures it in one command; `audio:measure` reports level, continuity and shape for one file or
two side by side; `compare:reference` renders a case under `fixtures/reference/<module>/<case>/` and
prints its features against a recording of the reference instrument, with the tolerances the case names.
The first case is the sine pattern against the user's own export.

## Consequences

- The user's patch, rendered through the device path at any period, is identical to the offline render
  and measures crest 1.413 against the reference's 1.414, THD 0.00% against 0.00%.
- **`Engine::renderInterleaved` cannot be called with a bare snapshot any more.** Anything that wants to
  drive the engine hands it a `Transport`, and the engine owns how often it ticks.
- **The offline renderer is not a shortcut.** It is the device path with a chosen period. Anything that
  behaves differently between the two is a bug in the caller, by construction, and the identity test is
  where it shows.
- **Every ported module gets a reference case before it is called done.** The shape scales: a compressor,
  a delay, a filter are compared the same way, the same signal in and features out with deltas. The
  reference recordings are made by a person in the reference instrument; nothing here pretends
  otherwise.
- **What this does not decide.** Real devices may still grant a period this engine did not ask for;
  that is now visible, not fixed. Capture records the null device in tests and a real device in a
  session, but a scenario cannot hear a real device's own artefacts (dropouts, resampling), only what
  the engine handed it.
