import { applyOps } from "@renderer/patch/ops";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { PatchDoc, PatchOp } from "@shared/protocol/patch";
import { Application } from "pixi.js";
import "pixi.js/unsafe-eval";
import { useCallback, useEffect, useRef, useState } from "react";
import { GridInteraction } from "../GridInteraction";
import { GridRenderer } from "../GridRenderer";
import { DESCRIPTORS } from "./fixtures";

/**
 * A working grid with no engine behind it.
 *
 * This is the mocked interface: the story holds the patch document in ordinary state and applies the
 * same operations the application applies, through the same `applyOps` the patch store uses. What is
 * absent is only the engine and the stores, so dragging a module and turning a knob take exactly the
 * code path they take in the application, and anything that works here works there.
 *
 * It also shows the document beside the canvas, which makes the story a debugging tool rather than
 * only a picture: you can watch the operations land.
 */

export interface InteractivePatchProps {
  initial: PatchDoc;
  width?: number;
  height?: number;
  /** Shows the live document beside the canvas. */
  showDocument?: boolean;
}

export const InteractivePatch = ({
  initial,
  width = 900,
  height = 480,
  showDocument = true,
}: InteractivePatchProps) => {
  const host = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GridRenderer | null>(null);
  const [doc, setDoc] = useState(initial);
  const [log, setLog] = useState<string[]>([]);
  const theme = useThemeStore((s) => s.theme);

  // The renderer is imperative and long-lived, so the callbacks reach the current document through a
  // ref rather than through a closure that would capture the first one and never see another.
  const docRef = useRef(doc);
  docRef.current = doc;

  const apply = useCallback((ops: PatchOp[], note: string) => {
    const next = applyOps(docRef.current, ops);
    docRef.current = next;
    setDoc(next);
    rendererRef.current?.sync(next);
    setLog((previous) => [note, ...previous].slice(0, 8));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let app: Application | null = null;
    const stop: (() => void)[] = [];

    const setup = async () => {
      const element = host.current;
      if (element === null) return;
      const created = new Application();
      await created.init({
        width,
        height,
        // WebGL rather than letting Pixi choose. Its WebGPU path fails to acquire a context in some
        // Electron configurations and the only symptom is a canvas that never appears; WebGL is
        // available everywhere this runs and is more than enough for two dimensions of flat shapes.
        preference: "webgl",
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio,
      });
      if (cancelled) {
        created.destroy(true, { children: true });
        return;
      }
      app = created;
      element.appendChild(created.canvas);

      const renderer = new GridRenderer(created, theme, DESCRIPTORS);
      rendererRef.current = renderer;
      renderer.drawBackground();
      renderer.sync(docRef.current);

      const interaction = new GridInteraction(renderer, created.canvas, {
        onNodesMoved: (moves) => {
          apply(
            moves.map(
              (m): PatchOp => ({ op: "moduleMove", id: m.id, x: m.x, y: m.y }),
            ),
            `moved ${moves.map((m) => m.id).join(", ")}`,
          );
        },
        onParamChange: (module, param, value, done) => {
          // Only the release is written to the document, exactly as in the application: the moving
          // knob is already on the canvas, and a document write per frame would be pointless here and
          // a flood of undo entries there.
          if (done)
            apply(
              [{ op: "paramSet", module, param, value }],
              `${module}.${param} = ${value.toFixed(3)}`,
            );
        },
        onSelectionChanged: (ids) =>
          setLog((p) => [`selected ${ids.length}`, ...p].slice(0, 8)),
      });
      stop.push(interaction.attach());
    };

    void setup();
    return () => {
      cancelled = true;
      for (const off of stop) off();
      rendererRef.current?.destroy();
      rendererRef.current = null;
      app?.destroy(true, { children: true });
    };
  }, [apply, theme, width, height]);

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div ref={host} style={{ width, height, flex: "none" }} />
      {showDocument && (
        <div
          style={{
            width: 280,
            height,
            overflow: "auto",
            font: "11px ui-monospace, monospace",
            color: "var(--color-muted-foreground)",
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 4,
            padding: 8,
          }}
        >
          <strong style={{ color: "var(--color-foreground)" }}>Recent</strong>
          <ul style={{ margin: "4px 0 12px", paddingLeft: 16 }}>
            {log.map((line, i) => (
              // The log is append-only and short; position is the only identity these lines have.
              // biome-ignore lint/suspicious/noArrayIndexKey: entries have no id and never reorder
              <li key={i}>{line}</li>
            ))}
            {log.length === 0 && <li>drag a module, or a knob</li>}
          </ul>
          <strong style={{ color: "var(--color-foreground)" }}>Document</strong>
          <pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>
            {JSON.stringify(
              doc.modules.map((m) => ({
                id: m.id,
                x: m.x,
                y: m.y,
                params: m.params,
              })),
              null,
              1,
            )}
          </pre>
        </div>
      )}
    </div>
  );
};
