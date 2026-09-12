# 0001. Bitwig's Grid is the reference for voice semantics

2026-09-10. Accepted.

## Context

phasegrid2 is a Grid-like instrument, and Bitwig's Grid is the thing it is like. Until now that
resemblance was about the surface -- a canvas of modules, cables, per-voice signals -- and every
question underneath it was answered from first principles, one at a time. Polyphony is where that ran
out. A patch can be monophonic or not, a voice can outlive its note or not, a pool can be a fixed cost
or an allocation, and each of those has a defensible answer that composes badly with the others. We
picked one such answer alone (see [0002](0002-a-released-voice-lives-only-while-a-module-holds-it.md))
and it was wrong in a way that took an afternoon and a spectrum analyser to see.

The four models worth copying differ mostly in when a voice ends:

| System | The pool | When a voice ends |
|---|---|---|
| Bitwig Grid | per-instrument, a voice count in the inspector | when every module that opted into voice lifetime has finished with it |
| Max `poly~` | `poly~` instances | when the voice itself marks `thispoly~` not busy, conventionally at the end of its envelope |
| SuperCollider | a synth per note | when a UGen with `doneAction: 2` finishes, conventionally the envelope |
| VCV Rack | up to 16 channels on every cable, always processed | never; a channel is reassigned, not freed |

Three of the four agree: the voice ends when something inside it says it is done, and that something
is conventionally the envelope. VCV is the outlier, and its model is the eurorack one -- every channel
costs its CPU forever, because in a rack nothing knows what a note is. That is a coherent choice for a
rack and the wrong one for an instrument with a voice count.

## Decision

Where a genuine choice exists in how voices, notes and instruments behave, phasegrid2 takes Bitwig's
answer, and a deviation is a decision that gets recorded here rather than a detail settled in a module.

This is a decision about semantics, not about surface. It does not mean copying Bitwig's naming, its
interface, its parameter ranges or its file formats, and it does not make phasegrid2 compatible with
Bitwig in any sense a user could act on. It means that when we ask "what should happen when a note ends
under an oscillator with no envelope", the answer we reach for first is the one a Bitwig user already
has in their hands, because they are the person this instrument is for.

The reason is not deference. It is that voice semantics are a system, not a list: the voice count, what
ends a voice, what a mono mode is, what stealing does, and what a per-voice signal means only make sense
together, and Bitwig's set is known to hold together under a decade of patches. Assembling our own set
one local answer at a time is how we got a droning sine.

## Consequences

- The vocabulary follows: an instrument has a voice count, a voice is *held* while its note is, and
  after that it is *releasing* until whatever is still using it has finished. `docs/engine.md` uses
  these words for the scheduler contract.
- Voice lifetime is per-module and opt-in, which is [0002](0002-a-released-voice-lives-only-while-a-module-holds-it.md).
- Two things Bitwig has are now specified rather than open, and will be built against this record when
  they are built: **mono modes** (True Mono is one voice that does not retrigger its envelopes on a
  legato note; Digi Mono alternates two voices so every note retriggers) and **voice stacking** (a note
  playing the patch more than once, with per-stack modulation). A voice count of one already gives
  True Mono's allocation; what it does not yet give is the envelope behaviour.
- VCV's model is rejected for the instrument, including its appeal: a fixed cost is simpler to reason
  about and simpler to schedule. We pay for the scheduler that runs only live pairs, and get a pool of
  sixteen that costs nothing while nothing plays.
- Where Bitwig is silent or its behaviour is unclear from outside -- which voice a steal takes, and on
  what curve -- the classic allocator rule stands (free voice, then longest released, then longest
  held), because Max, the literature and every hardware synth of the era agree on it.
