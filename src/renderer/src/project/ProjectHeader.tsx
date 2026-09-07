import { useEngineStore } from "@renderer/engine/engine-store";
import { useProjectStore } from "@renderer/project/project-store";
import { NOTE_NAMES, SCALE_NAMES, scaleLabel } from "@shared/protocol/project";
import { useEffect, useState } from "react";
import styles from "./ProjectHeader.module.css";

/**
 * The strip above the grid: transport, tempo, meter, scale.
 *
 * These are properties of the piece rather than of any module, which is why they live on the project
 * and are edited here rather than on a node somewhere in the patch.
 */
export const ProjectHeader = () => {
  const project = useProjectStore((s) => s.active());
  const setTempo = useProjectStore((s) => s.setTempo);
  const setTimeSignature = useProjectStore((s) => s.setTimeSignature);
  const setScale = useProjectStore((s) => s.setScale);
  const call = useEngineStore((s) => s.call);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState({ bar: 0, beat: 0 });

  // The engine owns the playhead, so the header follows it rather than counting time itself. Two
  // clocks always drift, and the one that matters is the one making sound.
  useEffect(() => {
    return window.engine.onEvent((event) => {
      if (event.event !== "transport.position") return;
      const data = event.data as {
        bar?: number;
        beat?: number;
        playing?: boolean;
      };
      if (typeof data.bar === "number" && typeof data.beat === "number")
        setPosition({ bar: data.bar, beat: data.beat });
      if (typeof data.playing === "boolean") setPlaying(data.playing);
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

  if (project === null) return <div className={styles.root} />;

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.transport}
        aria-pressed={playing}
        aria-label={playing ? "Stop" : "Play"}
        onClick={() => {
          void call(playing ? "transport.stop" : "transport.play", {}).catch(
            () => {},
          );
          setPlaying(!playing);
        }}
      >
        {playing ? "■" : "▶"}
      </button>

      <label className={styles.field}>
        <span className={styles.caption}>Tempo</span>
        <input
          className={styles.number}
          type="number"
          min={20}
          max={400}
          step={0.01}
          value={project.tempo}
          aria-label="Tempo"
          onChange={(event) => setTempo(Number.parseFloat(event.target.value))}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.caption}>Meter</span>
        <span className={styles.meter}>
          <input
            className={styles.small}
            type="number"
            min={1}
            max={64}
            value={project.timeSignature.numerator}
            aria-label="Beats per bar"
            onChange={(event) =>
              setTimeSignature({
                ...project.timeSignature,
                numerator: Math.max(
                  1,
                  Math.min(64, Number.parseInt(event.target.value, 10) || 4),
                ),
              })
            }
          />
          <span aria-hidden>/</span>
          <select
            className={styles.select}
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
      <output className={styles.position} aria-label="Position">
        {position.bar + 1}.{Math.floor(position.beat) + 1}
      </output>

      <label className={styles.field}>
        <span className={styles.caption}>Scale</span>
        <span className={styles.meter}>
          <select
            className={styles.select}
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
            className={styles.select}
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

      <span className={styles.spacer} />
      <span
        className={styles.name}
        title={
          project.kind === "example"
            ? "An example: it has nowhere to save to"
            : undefined
        }
      >
        {project.name}
        {project.kind === "example" && (
          <span className={styles.badge}>example</span>
        )}
      </span>
    </div>
  );
};
