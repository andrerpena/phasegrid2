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
