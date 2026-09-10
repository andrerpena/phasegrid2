# Architecture decisions

One file per decision, `NNNN-what-was-decided.md`, numbered in the order they were taken and never
renumbered. A record says what was decided, what it is instead of, and what it costs. It is written
once, when the decision is made, and after that it is history: a decision that turns out wrong gets a
new record that supersedes it rather than an edit, so the reasoning that led there stays readable.

What belongs here is a choice that constrains later work and that the code cannot state for itself --
a model adopted from elsewhere, a rule several modules have to obey, a shape chosen over a cheaper one.
What does not belong here is anything the code, `docs/engine.md` or the specs under `docs/superpowers/specs`
already say: a record points at those for the mechanism and keeps only the reasoning.

| # | Decision | Date |
|---|---|---|
| [0001](0001-bitwig-grid-is-the-reference-for-voice-semantics.md) | Bitwig's Grid is the reference for voice semantics | 2026-09-10 |
| [0002](0002-a-released-voice-lives-only-while-a-module-holds-it.md) | A released voice lives only while a module holds it | 2026-09-10 |
| [0003](0003-a-voice-fades-out-and-the-sine-starts-at-zero.md) | A voice fades out, and the sine starts at zero | 2026-09-10 |
| [0004](0004-a-waveform-is-measured-by-its-shape.md) | A waveform is measured by its shape, and Fold 0 is a sine | 2026-09-10 |
| [0005](0005-the-transport-ticks-per-engine-block.md) | The transport ticks per engine block, and the live output is capturable | 2026-09-10 |
| [0006](0006-the-output-clips-like-the-reference-instrument.md) | The output clips like the reference instrument's, and says so | 2026-09-10 |
| [0007](0007-what-we-take-from-vcv-rack.md) | What we take from VCV Rack, and what we leave | 2026-09-10 |
| [0008](0008-the-envelope-is-the-reference-instrument-s-adsr.md) | The envelope is the reference instrument's ADSR, on the vendored envelope | 2026-09-10 |
