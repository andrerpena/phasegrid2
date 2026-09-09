import { commandRegistry } from "@renderer/commands/registry";
import { useNumericDraft } from "@renderer/components/form-controls";
import { useEngineStore } from "@renderer/engine/engine-store";
import { useProjectStore } from "@renderer/project/project-store";
import { useTransportStore } from "@renderer/transport/transport-store";
import { cn } from "@renderer/utils/cn";
import {
  DEFAULT_TIME_SIGNATURE,
  NOTE_NAMES,
  SCALE_INTERVALS,
  SCALE_NAMES,
  scaleLabel,
} from "@shared/protocol/project";
import { useEffect, useState } from "react";

/** Every number and picker in the strip shares this: tabular figures so a changing tempo does not
 *  make the row jitter sideways. */
const FIELD =
  "rounded-sm border border-border bg-input px-0.5 font-[inherit] text-xs text-foreground tabular-nums";
const CAPTION = "text-2xs uppercase tracking-wide text-muted-foreground";
/** What the tempo field shows while there is no project, which is only the frame before there is one. */
const DEFAULT_TEMPO = 120;

/**
 * The strip above the grid: transport, tempo, meter, scale.
 *
 * These are properties of the piece rather than of any module, which is why they live on the project
 * and are edited here rather than on a node somewhere in the patch.
 */
export const ProjectHeader = () => {
  const project = useProjectStore((s) => s.active());
  const dirtyIds = useProjectStore((s) => s.dirtyIds);
  const setTempo = useProjectStore((s) => s.setTempo);
  const setTimeSignature = useProjectStore((s) => s.setTimeSignature);
  const setScale = useProjectStore((s) => s.setScale);
  const call = useEngineStore((s) => s.call);
  const playing = useTransportStore((s) => s.playing);
  const toggle = useTransportStore((s) => s.toggle);
  const [position, setPosition] = useState({ bar: 0, beat: 0 });

  // Typed numbers follow the one rule in `numeric-draft.ts`: the field shows what is being typed,
  // and the project only hears a value. Before this, clearing the tempo sent `NaN` and the next
  // digit was clamped to 20, so `137` came out as `20` -- and the meter could not be cleared at all.
  // Declared before the early return below, because hooks cannot be skipped.
  const tempo = useNumericDraft({
    value: project?.tempo ?? DEFAULT_TEMPO,
    onChange: setTempo,
    min: 20,
    max: 400,
  });
  const beatsPerBar = useNumericDraft({
    value: project?.timeSignature.numerator ?? DEFAULT_TIME_SIGNATURE.numerator,
    onChange: (numerator) => {
      if (project === null) return;
      setTimeSignature({ ...project.timeSignature, numerator });
    },
    min: 1,
    max: 64,
    integer: true,
  });

  // The engine owns the playhead, so the header follows it rather than counting time itself. Two
  // clocks always drift, and the one that matters is the one making sound.
  useEffect(() => {
    return window.engine.onEvent((event) => {
      if (event.event !== "transport.position") return;
      const data = event.data as { bar?: number; beat?: number };
      if (typeof data.bar === "number" && typeof data.beat === "number")
        setPosition({ bar: data.bar, beat: data.beat });
    });
  }, []);

  // Tempo and meter are pushed to the engine when they change here, because the engine is what plays.
  useEffect(() => {
    if (project === null) return;
    void call("transport.setTempo", { tempo: project.tempo }).catch(() => {});
  }, [project, call]);

  useEffect(() => {
    if (project === null) return;
    void call("transport.setTimeSignature", {
      numerator: project.timeSignature.numerator,
      denominator: project.timeSignature.denominator,
    }).catch(() => {});
  }, [project, call]);

  // And the scale, for the modules that snap pitch to it. The engine takes intervals, not a name.
  useEffect(() => {
    if (project === null) return;
    void call("transport.setScale", {
      root: project.scale.root,
      intervals: [...SCALE_INTERVALS[project.scale.name]],
    }).catch(() => {});
  }, [project, call]);

  const strip =
    "flex min-h-8 items-center gap-3 border-b border-border bg-card px-2 text-xs";

  if (project === null) return <div className={strip} />;

  return (
    <div className={strip}>
      {/*
        One control, not two.

        The transport is the clock and the output is the output, and for a while these were separate
        buttons on the honest grounds that a modular patch is not gated by its clock. That was true and
        useless: a person presses stop to make it stop, and a stop button that leaves an oscillator
        droning is a stop button that does not work. So this does both, and holds the patch as well;
        the store says why. The button is a view of that store, so a key, the palette and this click
        are the same gesture.
      */}
      <button
        type="button"
        className={cn(
          "h-5 w-6 cursor-pointer rounded-sm border border-border bg-secondary leading-none text-foreground",
          playing && "border-ring text-signal-note",
        )}
        aria-pressed={playing}
        aria-label={playing ? "Stop" : "Play"}
        title={
          playing
            ? "Stops the clock, holds the patch and silences the output"
            : "Starts the clock, runs the patch and opens the output"
        }
        onClick={toggle}
      >
        {playing ? "■" : "▶"}
      </button>

      <label className="flex items-center gap-1">
        <span className={CAPTION}>Tempo</span>
        <input
          className={`${FIELD} w-[68px]`}
          type="number"
          min={20}
          max={400}
          step={0.01}
          aria-label="Tempo"
          {...tempo}
        />
      </label>

      <label className="flex items-center gap-1">
        <span className={CAPTION}>Meter</span>
        <span className="flex items-center gap-0.5 text-muted-foreground">
          <input
            className={`${FIELD} w-[34px]`}
            type="number"
            min={1}
            max={64}
            aria-label="Beats per bar"
            {...beatsPerBar}
          />
          <span aria-hidden>/</span>
          <select
            className={FIELD}
            value={project.timeSignature.denominator}
            aria-label="Beat value"
            onChange={(event) =>
              setTimeSignature({
                ...project.timeSignature,
                denominator: Number.parseInt(event.target.value, 10),
              })
            }
          >
            {/* Note values only: the engine refuses anything that is not a power of two, because a
                bar of 4/3 is not something notation can express. */}
            {[1, 2, 4, 8, 16, 32].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </span>
      </label>

      {/* A live region: the playhead changes without anyone acting, and a screen reader should be
          able to ask where it is rather than being told twenty times a second. */}
      <output
        className="min-w-12 tabular-nums text-muted-foreground"
        aria-label="Position"
      >
        {position.bar + 1}.{Math.floor(position.beat) + 1}
      </output>

      <label className="flex items-center gap-1">
        <span className={CAPTION}>Scale</span>
        <span className="flex items-center gap-0.5 text-muted-foreground">
          <select
            className={FIELD}
            value={project.scale.root}
            aria-label="Scale root"
            onChange={(event) =>
              setScale({
                ...project.scale,
                root: Number.parseInt(event.target.value, 10),
              })
            }
          >
            {NOTE_NAMES.map((note, i) => (
              <option key={note} value={i}>
                {note}
              </option>
            ))}
          </select>
          <select
            className={FIELD}
            value={project.scale.name}
            aria-label="Scale"
            onChange={(event) =>
              setScale({
                ...project.scale,
                name: event.target.value as typeof project.scale.name,
              })
            }
          >
            {SCALE_NAMES.map((name) => (
              <option key={name} value={name}>
                {scaleLabel({ root: 0, name }).replace("C ", "")}
              </option>
            ))}
          </select>
        </span>
      </label>

      <span className="flex-1" />
      <span className="text-muted-foreground">{project.name}</span>

      {/*
        One button, whose label says which of the two things it will do.

        A project that has been saved before is saved again where it already lives; anything else asks
        for a name first. Disabled once there is nothing to save, because a Save button that is always
        live tells you nothing about whether your work is safe — which is the only question it exists
        to answer.
      */}
      <button
        type="button"
        // Dimmed rather than hidden: the button staying in place is what makes "Saved" a state you
        // can see rather than a thing you have to remember.
        className="flex-none cursor-pointer rounded-sm border border-border bg-card px-2 py-1 text-xs text-foreground enabled:hover:border-ring disabled:cursor-default disabled:text-muted-foreground"
        disabled={!dirtyIds.includes(project.id)}
        title={
          dirtyIds.includes(project.id)
            ? "Save this project into the workspace"
            : "Saved"
        }
        onClick={() => void commandRegistry.dispatch("project.save")}
      >
        {project.slug === undefined ? "Save As…" : "Save"}
      </button>
    </div>
  );
};
