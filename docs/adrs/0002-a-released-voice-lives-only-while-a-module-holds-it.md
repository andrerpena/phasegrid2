# 0002. A released voice lives only while a module holds it

2026-09-10. Accepted. Follows [0001](0001-bitwig-grid-is-the-reference-for-voice-semantics.md).

## Context

A voice is easy to start and hard to end. The note on says exactly when it begins; the note off does not
say when it stops, because a filter may still be ringing and an envelope may have seconds of release
left. Something has to decide, and what it decides costs either a cut-off tail or a voice that never
comes back.

phasegrid2 had answered this twice, badly, in both directions.

The first answer, before the instrument model, was that a voice ends with its note. A note off returned
the voice to the pool immediately and the next note took it. Release tails were cut off. That is the
answer a sequencer gives, not an instrument.

The second answer, which the instrument model introduced, was to measure: an exit reported the peak it
heard from each voice, and a releasing voice nobody had heard above a floor for three blocks was freed.
It sounds robust and it is not. Measurement cannot tell a release tail from a wave that is simply still
running, so a voice with nothing to end it is never freed. The patch that found this was the simplest
polyphonic patch there is -- a pattern of single notes, a converter, a sine, the output:

| Render | Peak | What sounds |
|---|---|---|
| the reference instrument, one note | 0.31 | one partial |
| ours, the same four-note pattern, 4 s | 6.18 | all four notes at once, still climbing |

Every note took a fresh voice, none was ever returned, and the pool filled with sines droning at their
last pitch until the sum clipped. The user heard it as a rough sine and was right.

The measured rule is also the one condition Bitwig ships *off*: an exit that keeps a voice alive until
it falls silent is `Audio Out` with **Affect voice lifetime** enabled, and it is disabled by default,
precisely because "still audible" is not the same question as "still needed".

## Decision

A voice's life after its note off is decided by claims, not by measurement. Each block, any module that
knows the voice is still going says so, through `VoiceActivity::hold(voice)`. After the block's passes,
`settle()` frees every releasing voice nobody claimed. A claim lasts one block and is made again for as
long as it holds; there is no timer, no tail count, no memory between blocks.

Who claims, and whether they do by default, is Bitwig's table:

| Holder | Claims the voice while | Default |
|---|---|---|
| `env.dahdsr` | the envelope has not finished its release stage | on |
| `io.audioOut` | what it hears from the voice is above `kVoiceSilence` | off |
| `voices.sum` | the same | off |

Each carries an `Affect voice lifetime` toggle, so a patch can take a holder out of the decision -- a
long filter envelope that should not extend the note, an output that should. Claims only ever extend a
voice: turning one on can make notes longer, never shorter, which is what makes the toggles safe to
reason about one at a time.

A voice nobody claims is free at the end of the block its note ended in. That is not a fallback, it is
the point: an oscillator with no envelope stops with its note, a run of single notes plays on one voice,
and a patch pays for the voices it is using.

## Consequences

- **The bug is gone by construction.** The drone patch renders at peak 1.0 across four seconds, one
  note at a time, and reuses voice 0 for every note. No level threshold is involved in that result.
- **Silence detection survives as a choice.** A patch that wants a tail nothing else describes -- a
  delay line inside the voice, a sampler one-shot -- enables it on the exit and gets the old behaviour
  where it is actually wanted.
- **Modules opt in through one seam.** A vendored module declares `ModuleSpec::alive`, which returns
  the lanes it is still busy with; the adapter turns that into claims and gates it on the module's
  `lifetime` param. `env.dahdsr` reads the vendored envelope's own stage output for this, so the claim
  is the envelope's actual state rather than a guess from its level.
- **A new module that can outlive its note has an obligation**: declare the toggle and claim per pass.
  A module that cannot -- an oscillator, a filter, a shaper -- declares nothing and correctly has no
  say. `docs/adding-a-module.md` states this.
- **The scheduler contract shrank.** `kVoiceTailBlocks` and the "instrument has no exit" special case
  are gone. That case existed only because a voice could not be freed without an exit to hear it silent;
  freeing no longer depends on an exit existing, so an instrument without one needs no rule of its own
  and its envelopes still end its voices.
- **What this does not decide.** `kVoiceSilence` is one constant rather than a per-exit threshold, and
  a voice is stolen rather than faded when the pool is full. Both are Bitwig-shaped questions still open.
