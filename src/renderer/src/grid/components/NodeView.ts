import { hexToNumber } from "@renderer/lib/color";
import { paramValue } from "@renderer/patch/params";
import type { GridColors } from "@renderer/theming/theme";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchModule } from "@shared/protocol/patch";
import { Container, Graphics } from "pixi.js";
import { type Block as BlockGeometry, composeFace, type Face } from "../face";
import { paramFraction } from "../layout";
import { type Block, type BlockStyle, blockStyle } from "./blocks/Block";
import { JackBlock } from "./blocks/JackBlock";
import { KnobBlock } from "./blocks/KnobBlock";
import { type Level, MeterBlock } from "./blocks/MeterBlock";
import { type NotesView, PianoRollBlock } from "./blocks/PianoRollBlock";
import { ScopeBlock } from "./blocks/ScopeBlock";
import { TextBlock } from "./blocks/TextBlock";
import { TitleBlock } from "./blocks/TitleBlock";
import { ValueBlock } from "./blocks/ValueBlock";
import { WaveBlock } from "./blocks/WaveBlock";

/**
 * One module on the grid: a framed panel of the blocks its face is made of, the title block across
 * the top and the rest under it.
 *
 * Everything about how it looks comes from the engine's descriptor and the theme. There is no table
 * here mapping module ids to appearances, and no branch on what kind of module this is: the face
 * says which blocks, each block draws itself, and the node routes what it is told -- a value, a live
 * value, a picture, a trace, a reading, a level, a cable plugged in -- to the blocks that answer for it. That is what makes adding
 * a module to the engine enough to see it drawn correctly, and adding a kind of block one file.
 *
 * Built once and updated in place. A patch redraws whenever a parameter moves, and rebuilding a node's
 * graphics on every frame is how a canvas starts dropping them.
 */

/** The last trace a scope drew, as a script sees it: which publish, how long, and how loud. */
export interface TraceSummary {
  /** The engine's count of the publish, as a string: a bigint does not survive JSON. */
  index: string;
  frames: number;
  peak: number;
}

/** The last reading a readout showed, as a script sees it: which publish, and the value per channel. */
export interface Reading {
  index: string;
  channels: number[];
}

/** The last level a meter showed, as a script sees it. */
export interface LevelSummary {
  index: string;
  peak: number[];
  rms: number[];
  clipped: boolean[];
}

/**
 * What is on the piano roll right now, as a script sees it.
 *
 * A summary rather than the notes themselves: a scenario asks "is it playing, and is it moving",
 * and the notes are the engine's business. `sounding` is what a test watches change.
 */
export interface NotesSummary {
  index: string;
  count: number;
  sounding: number;
  phase: number;
}

export interface NodeStyle {
  colors: GridColors;
  /** The module's accent, from its category, used for the title and the value arcs. */
  accent: number;
}

/** One block component per kind of block geometry. Adding a kind is a line here and a file beside it. */
function buildBlock(
  geometry: BlockGeometry,
  style: BlockStyle,
  label: string,
): Block {
  switch (geometry.kind) {
    case "title":
      return new TitleBlock(geometry, label, style);
    case "jack":
      return new JackBlock(geometry, style);
    case "knob":
      return new KnobBlock(geometry, style);
    case "wave":
      return new WaveBlock(geometry, style);
    case "scope":
      return new ScopeBlock(geometry, style);
    case "value":
      return new ValueBlock(geometry, style);
    case "meter":
      return new MeterBlock(geometry, style);
    case "text":
      return new TextBlock(geometry, style);
    case "pianoRoll":
      return new PianoRollBlock(geometry, style);
  }
}

export class NodeView {
  readonly view = new Container();
  readonly face: Face;

  private readonly frame = new Graphics();
  private readonly blocks: Block[] = [];
  private readonly jacks = new Map<string, JackBlock>();
  private readonly knobs = new Map<string, KnobBlock>();
  private readonly wave: WaveBlock | null = null;
  private readonly scope: ScopeBlock | null = null;
  private readonly readout: ValueBlock | null = null;
  private readonly meter: MeterBlock | null = null;
  private readonly texts = new Map<string, TextBlock>();
  private readonly pianoRoll: PianoRollBlock | null = null;
  /** The last notes put on the roll, by the engine's count: what a script asks about. */
  private notes: NotesSummary | null = null;
  /** The sounding steps of each text property, so the editor can light them up too. */
  private sounding = new Map<string, { from: number; to: number }[]>();
  /** The last trace put on the scope, by the engine's count, and its size: what a script asks about. */
  private trace: TraceSummary | null = null;
  /** The last reading put on the readout, the same way. */
  private reading: Reading | null = null;
  /** The last level put on the meter, the same way. */
  private level: LevelSummary | null = null;

  constructor(
    /**
     * The module as the document last described it, for drawing and for nothing else.
     *
     * Deliberately not readable from outside. A value read back off a node is a value read off a copy,
     * and a copy is a thing that can be out of date; anything that needs to know what a parameter is
     * set to asks the document, which is where parameter values live. This is only ever compared with
     * the next module handed in, to tell whether there is anything to redraw.
     */
    private module: PatchModule,
    readonly descriptor: ModuleDescriptor,
    private style: NodeStyle,
  ) {
    this.face = composeFace(descriptor);
    const colors = blockStyle(style.colors, style.accent);

    this.view.addChild(this.frame);
    this.drawFrame();

    const label = module.label ?? descriptor.name;
    for (const geometry of this.face.blocks) {
      const block = buildBlock(geometry, colors, label);
      this.blocks.push(block);
      this.view.addChild(block.view);
      if (block instanceof JackBlock)
        this.jacks.set(
          socketKey(geometry.name, block.geometry.socket.side),
          block,
        );
      else if (block instanceof KnobBlock) this.knobs.set(geometry.name, block);
      else if (block instanceof WaveBlock) this.wave = block;
      else if (block instanceof ScopeBlock) this.scope = block;
      else if (block instanceof ValueBlock) this.readout = block;
      else if (block instanceof MeterBlock) this.meter = block;
      else if (block instanceof TextBlock) this.texts.set(geometry.name, block);
      else if (block instanceof PianoRollBlock) this.pianoRoll = block;
    }
    this.applyValues(module);
    this.view.position.set(module.x ?? 0, module.y ?? 0);
  }

  /**
   * The wave to show on the panel: one cycle, -1..1, as the engine drew it.
   *
   * The node never works this out for itself. The picture comes from the module that makes the sound,
   * through `module.preview`, and is handed in here by whoever asked for it; a node with no panel
   * ignores it.
   */
  setWave(samples: ArrayLike<number>): void {
    this.wave?.setWave(samples);
  }

  /**
   * The window on the wire into this module, one array per channel, as the engine published it.
   * Read from the segment by whoever watches it and handed in here; a node with no scope ignores it.
   */
  setTrace(index: bigint, channels: ArrayLike<number>[]): void {
    if (this.scope === null) return;
    this.scope.setTrace(channels);
    let peak = 0;
    for (const samples of channels)
      for (let i = 0; i < samples.length; i++)
        peak = Math.max(peak, Math.abs(samples[i]));
    this.trace = {
      index: index.toString(),
      frames: channels[0]?.length ?? 0,
      peak,
    };
  }

  /** What the scope last drew, or null for a module without one or one nothing has published to. */
  traceOf(): TraceSummary | null {
    return this.trace;
  }

  /**
   * The last value on the wire into this module, per channel, as the engine published it. A node
   * with no readout ignores it.
   */
  setValue(index: bigint, values: number[]): void {
    if (this.readout === null) return;
    this.readout.setValue(values);
    this.reading = { index: index.toString(), channels: values };
  }

  /** What the readout last showed, or null for a module without one or one nothing has published to. */
  readingOf(): Reading | null {
    return this.reading;
  }

  /** The level on the wire into this module, as the engine published it. Ignored without a meter. */
  setLevel(index: bigint, level: Level): void {
    if (this.meter === null) return;
    this.meter.setLevel(level);
    this.level = {
      index: index.toString(),
      peak: level.peak,
      rms: level.rms,
      clipped: level.clipped.map((c) => c > 0),
    };
  }

  /** What the meter last showed, or null for a module without one or one nothing has published to. */
  levelOf(): LevelSummary | null {
    return this.level;
  }

  /**
   * Where modulation has put a parameter this frame, 0..1 of its range, or null once nothing feeds
   * it. Telemetry's channel into the node, kept apart from the document's: it moves the pointer and
   * never the value.
   */
  setLive(paramId: string, fraction: number | null): void {
    this.knobs.get(paramId)?.setLive(fraction);
  }

  /**
   * Where modulation has a knob right now, 0..1, or null: for a script that wants to know whether
   * a knob is turning. Null too for a parameter with no knob on the face.
   */
  liveOf(paramId: string): number | null {
    return this.knobs.get(paramId)?.liveFraction ?? null;
  }

  /** Every knob to the document's value for it. */
  /**
   * The notes the module is playing, as the engine published them.
   *
   * They go to two places at once, which is the point of publishing them rather than working them
   * out here: the piano roll draws them, and every text property lights up the steps of its own
   * string that are sounding. Neither could be done in the interface, which cannot parse a pattern.
   */
  setNotes(index: bigint, reading: NotesView): void {
    this.pianoRoll?.setNotes(reading);
    this.notes = {
      index: index.toString(),
      count: reading.notes.length,
      sounding: reading.notes.filter((n) => n.sounding).length,
      phase: reading.phase,
    };
    // Every text property, not only the ones the face shows: the editor lights up the same steps,
    // and it opens on properties a face may have no room for.
    for (const [index, text] of this.descriptor.texts.entries()) {
      const ranges = reading.notes
        .filter((n) => n.sounding && n.textIndex === index && n.to > n.from)
        .map((n) => ({ from: n.from, to: n.to }));
      this.sounding.set(text.id, ranges);
      this.texts.get(text.id)?.setHighlights(ranges);
    }
  }

  /** Which steps of a text property are sounding, for anything drawing it outside the canvas. */
  soundingOf(textId: string): { from: number; to: number }[] {
    return this.sounding.get(textId) ?? [];
  }

  /** What is on the roll right now, for a script. Null before the engine has said anything. */
  notesOf(): NotesSummary | null {
    return this.notes;
  }

  /** What a text property currently holds, from the document, for a script. */
  textOf(textId: string): string | null {
    const value = this.module.data?.[textId];
    if (typeof value === "string") return value;
    return this.descriptor.texts.find((t) => t.id === textId)?.default ?? null;
  }

  private applyValues(module: PatchModule): void {
    for (const [paramId, knob] of this.knobs)
      knob.setValue(
        paramFraction(
          knob.geometry.param,
          paramValue(module, this.descriptor, paramId),
        ),
      );
    // A text property's value lives in the node's `data`, keyed by its id, and falls back to the
    // default the module declared -- exactly the rule `configure` follows in the engine.
    for (const [textId, block] of this.texts) {
      const value = module.data?.[textId];
      const declared = this.descriptor.texts.find((t) => t.id === textId);
      block.setValue(
        typeof value === "string" ? value : (declared?.default ?? ""),
      );
    }
  }

  private drawFrame(): void {
    const { width, height } = this.face;
    this.frame
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: hexToNumber(this.style.colors.nodeFill) })
      // Always the node's own border. Selection is the ring the renderer draws outside the node, and
      // a node that also recoloured its border would wear the selection twice.
      .stroke({ width: 1, color: hexToNumber(this.style.colors.nodeStroke) });
  }

  setPosition(x: number, y: number): void {
    this.view.position.set(x, y);
  }

  /**
   * Re-reads the module from the document. Called whenever the patch changes, which during a knob drag
   * is every frame.
   *
   * The knobs are only redrawn when the module is a different object than last time. `applyOps` builds
   * a new object for the module it changed and reuses every other, so a drag on one knob costs one
   * node's redraw rather than the whole patch's. The sockets are refreshed regardless, because hovering
   * changes them without the document changing at all.
   */
  update(
    module: PatchModule,
    connectedPorts: ReadonlySet<string>,
    hoveredPort: string | null,
  ): void {
    if (module !== this.module) {
      this.module = module;
      this.applyValues(module);
    }
    for (const jack of this.jacks.values()) {
      const id = jack.geometry.socket.port.id;
      jack.update({
        connected: connectedPorts.has(id),
        hovered: hoveredPort === id,
      });
    }
    for (const knob of this.knobs.values()) {
      const port = knob.geometry.modulationPort;
      if (port === null) continue;
      const connected = connectedPorts.has(port);
      knob.update({ connected, hovered: hoveredPort === port });
      // A knob nothing feeds any more goes back to drawing its own value at once, rather than staying
      // wherever the last telemetry frame left it until the next one, which never comes.
      if (!connected) knob.setLive(null);
    }
  }

  setStyle(style: NodeStyle): void {
    this.style = style;
    this.drawFrame();
    const colors = blockStyle(style.colors, style.accent);
    for (const block of this.blocks) block.setStyle(colors);
  }

  destroy(): void {
    for (const block of this.blocks) block.destroy();
    this.view.destroy({ children: true });
  }
}

/** Inputs and outputs may share an id, so a jack is keyed by both. */
function socketKey(portId: string, side: "input" | "output"): string {
  return `${side}:${portId}`;
}
