# 0008. The envelope is the reference instrument's ADSR, on the vendored envelope

2026-09-10. Accepted. Follows [0001](0001-bitwig-grid-is-the-reference-for-voice-semantics.md).

## Context

The question that started this was a user's, looking at an `Envelope` node sitting on the canvas with
nothing plugged into it: *where does it sit, and what do I connect it to?* It is a fair question, and the
module was to blame for it.

`env.dahdsr` was the vendored `EnvelopeModule` published straight through `vendor::buildDescriptor`.
Three things about that were wrong for this instrument.

**Its knobs were not in the units they claimed.** The generated descriptor took the vendored parameter
table verbatim: Attack ran 0 to 2.378 and was labelled `seconds`. It was not seconds. The vendored
control chain raises the value to the fourth power (`SynthModule::createPolyModControl`,
`ValueDetails::kQuartic`), so the real range was 0 to 32 s and the shipped default of `0.1495` meant half
a millisecond. Every example in the repository set `attack: 0.15, decay: 0.85, release: 0.6` — numbers
that read like fractions of a knob and meant 0.5 ms, 0.5 s and 0.1 s. `docs/engine.md` described the
problem at length and left it open. Nobody could dial that, and no interface could label it.

**It was only a modulator.** To hear it you also placed an `amp.vca`, turned its Gain to zero and patched
the envelope into the gain input. Every example did exactly that, which is four modules and three cables
for the most ordinary thing in subtractive synthesis.

**It showed nothing.** An envelope is a shape, and its face had four knobs and no picture of it.

The reference instrument's ADSR answers all three: times in seconds to eight, a signal path through the
module, and the shape drawn on its face. [0001](0001-bitwig-grid-is-the-reference-for-voice-semantics.md)
already makes that instrument the reference here, so this is applying a decision rather than taking one.

## Decision

**`env.adsr` replaces `env.dahdsr`, and keeps the vendored DSP.** `vital::Envelope`
(`engine/vendor/vital/src/synthesis/modulators/envelope.cpp`) is tested, allocation-free and poly_float
throughout, and its stage machine already behaves the way the reference instrument's documentation
*describes*: the attack runs from the envelope's current value to full scale over exactly the attack time
("rise time from current envelope value to 100%"), the release from the current value to zero over
exactly the release time, and its three power inputs feed `futils::powerScale`, which is what a "set
curve" is. What we replace is the vendored **wrapper**, not the envelope.

So `env.adsr` is an ordinary phasegrid module (`engine/src/modules/EnvAdsr.cpp`) that owns one
`vital::Envelope` per voice pair and plugs its own control outputs into it. It does not go through
`ModuleSpec`: that path generates the descriptor from the vendored parameter table (the wrong ranges),
maps ports one-to-one onto vendored ports (no room for a signal path or a bias output), and cannot
express a model switch. Delay and Hold are held at zero for the life of the instance, which is what makes
it four stages rather than six.

**The surface is the reference's.** Signal In and Gate In; Signal Out (the input with the envelope
applied), Envelope Out, Bias Out (the envelope less its sustain, so with Sustain at 75 % it runs −0.75 to
+0.25). Attack, Decay and Release run 0 to 8 s; Sustain 0 to 100 %.

**Gate on Notes becomes a rule rather than a toggle.** The reference connects the device's note gate to
Gate In through a pre-cord, on by default. phasegrid has no pre-cords, and the first instinct was to drop
the feature and say "patch the converter's Gate, it is one visible cable". That was wrong, and the patch
that showed it was the first one anyone builds: a pattern, a converter, an oscillator through the
envelope, the output — silent, with nothing on the module saying which of its five jacks was the one that
mattered. So: **an unconnected Gate follows the note the voice is playing.** That is not a pre-cord
smuggled in; it is a question the instrument can already answer, because inside an instrument a voice IS
its note and `VoiceActivity` records which voices hold one. `display.piano` reads the same thing for the
same reason. Outside an instrument there is no note, and an unconnected gate reads as held, so a global
envelope is usable as a plain shaper.

A voice's state is not quite enough on its own: a note that STEALS a live voice leaves it held before and
after, so the level says nothing happened and a mono patch — where every note steals — would open its
envelope once and never move it again. The pool numbers every note on, so a changed `VoiceActivity::age`
is a new note, and the derived gate drops for one frame there. That is the same dip `note.toPoly` puts on
its own Gate output, for the same reason.

It is block-accurate, not sample-accurate: the pool records a voice's state and its note count, not the
frame the note landed on, so an edge can be up to one block (2.7 ms at 48 kHz) early. A cable from the
converter's own Gate output is exact. That is why the port stays, and why its documentation says which is
which. There is no toggle, because the alternative it would offer — an unconnected gate that stays shut —
is silence, and nobody wants that on purpose.

**Two of the reference's details are absent.** *Modulator Out* is wireless modulation, and phasegrid
draws every cable — there is nothing for it to mean here. The vendored `phase` output goes too: the
module holds its own voice, so nothing downstream needs the stage, and the reference has no such port.

**The three models are our reading of three one-line descriptions**, and this is the part to revisit
against a recording:

| Model | Powers into the envelope | Timing | Signal Out |
|---|---|---|---|
| Analog — "set curves & non-linear VCA" | attack 2 (the vendored code negates it), decay −2, release −2: the library's own defaults, a segment that moves fast and then eases, as a capacitor charging does | as set | `in × env²`, the same curve `amp.vca`'s Exponential uses |
| Relative — "rate-differential curves" | the same curves | each knob is the time to cross the WHOLE range, so a stage with less ground to cover takes proportionally less | `in × env` |
| Digital — "exact timing" | all zero: straight lines | each stage lasts its knob's time whatever the distance | `in × env` |

Relative is implemented in the module, not in vendored code: it latches the envelope's level when a stage
begins and scales the time it feeds in — attack by `1 − v`, release by `v`, decay by `1 − sustain`. The
latch is the previous block's last value, up to one block (2.7 ms at 48 kHz) before the sample where the
vendored processor latches its own `start_value_`. That is an approximation, and it is the only one.

**A knob is dragged on its param's taper.** The renderer used to map a drag linearly across min..max and
ignore `ParamCurve` entirely, which would have put every musical envelope time in the first millimetre of
an eight-second knob. `ParamCurve::Quartic` is added and `shared/protocol/param-curve.ts` is the engine's
own arithmetic (`engine/src/core/Param.cpp`), used by both the drag and the drawing.

**The picture is the engine's.** `TelemetryKind::Envelope` carries the shape, the three breakpoints and
the playhead, written through `Module::preview` and published on the **preview** channel — not `display`,
because a held patch runs no module and the shape still has to follow a knob turned in the silence. The
face draws it with an `adsr` block that knows nothing about attacks.

**An enum can be drawn.** The Model switch needed a block, and the face language rejected enums outright
("which has no block yet"). `select:<id>` is a generic one: a cell shows the value's initial, wider shows
the label, clicking cycles. It works for every enum already in the catalogue.

## Consequences

- **`env.dahdsr` is gone**, with its tests, and every example, golden patch and fixture is repointed. A
  patch naming it stops loading. That is the clean break `CLAUDE.md` asks for, and there is no shim.
- **The holder table in [0002](0002-a-released-voice-lives-only-while-a-module-holds-it.md) reads
  `env.adsr`** where it said `env.dahdsr`. The rule is unchanged: the envelope claims its voice while its
  own stage is short of the end, gated by a `lifetime` toggle that is on by default.
- **The obvious patch works.** An oscillator through the envelope into the output makes sound with
  three cables and no gate, which is what the reference does with its pre-cord. The exact gate is still
  one cable away and the port documents when to reach for it.
- **The examples lost a module each.** `noteExample` no longer places an `amp.vca`: the oscillator runs
  through the envelope's signal path. That is also the answer to the question that started this, stated
  by the example rather than in prose.
- **The units problem is closed for this module and open for the others.** A generated descriptor whose
  vendored `value_scale` is not linear still lies about its unit, and a knob is now dragged on that
  wrong curve as well as drawn on it. `docs/engine.md` says to check `ValueDetails::value_scale` when a
  generated param's unit matters; the fix for each is the same as this one, and a `ModuleSpec` cannot do
  it, because the scaling lives in the vendored control chain.
- **A new way to use the vendored library is now established**: a native module may own a vendored
  `Processor` directly when the phasegrid-facing surface differs from the vendored module's.
  `docs/adding-a-module.md` says when to reach for it, and warns that it is the more expensive path.
- **The models are checkable and not yet checked.** `fixtures/reference/env.adsr/` holds a case with no
  recording in it; a reference export dropped in there and `npm run compare:reference -- env.adsr` decides
  whether the three readings above are right. Until then they are an interpretation, written down here so
  the next person argues with the reasoning rather than rediscovering it.
