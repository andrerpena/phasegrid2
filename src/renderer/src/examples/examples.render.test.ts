import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allExamples, type ModuleExample } from "./registry";

/**
 * Every example is rendered by the real engine and measured.
 *
 * This is what makes "one example per module" a guarantee rather than a hope. An example that does not
 * make the sound it claims to is worse than no example: it teaches the wrong thing about the module and
 * hides the fact that the module is broken.
 *
 * It shells out to the engine binary rather than mocking anything, because the claim being tested is
 * precisely that the real engine produces sound from this patch.
 */

const ENGINE = join(__dirname, "../../../../build/engine/phasegrid-engine");

/** Reads a float WAV. The engine writes IEEE float, which Node has no built-in reader for. */
function readWav(path: string): {
  channels: number;
  rate: number;
  left: number[];
} {
  const data = readFileSync(path);
  let at = 12;
  let channels = 2;
  let rate = 48000;
  let left: number[] = [];
  while (at < data.length - 8) {
    const id = data.toString("latin1", at, at + 4);
    const size = data.readUInt32LE(at + 4);
    if (id === "fmt ") {
      channels = data.readUInt16LE(at + 10);
      rate = data.readUInt32LE(at + 12);
    } else if (id === "data") {
      const samples: number[] = [];
      for (let i = 0; i < size; i += 4)
        samples.push(data.readFloatLE(at + 8 + i));
      left = samples.filter((_, i) => i % channels === 0);
    }
    at += 8 + size + (size & 1);
  }
  return { channels, rate, left };
}

function render(
  example: ModuleExample,
  seconds: number,
): { rms: number; peak: number } {
  const dir = mkdtempSync(join(tmpdir(), "pg-example-"));
  const patchPath = join(dir, "patch.json");
  const wavPath = join(dir, "out.wav");
  writeFileSync(patchPath, JSON.stringify(example.patch));
  execFileSync(
    ENGINE,
    ["--render", patchPath, "--out", wavPath, "--seconds", String(seconds)],
    {
      stdio: "pipe",
    },
  );
  const { left } = readWav(wavPath);
  const rms = Math.sqrt(
    left.reduce((sum, v) => sum + v * v, 0) / Math.max(1, left.length),
  );
  return { rms, peak: Math.max(...left.map(Math.abs)) };
}

describe("every module example", () => {
  const examples = allExamples();

  it("covers at least one module", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples.map((e) => [e.moduleId, e] as const))(
    "%s makes a sound",
    (_id, example) => {
      const { rms, peak } = render(example, 1);
      // A floor rather than a range: what matters is that it is audible and not silence. An example
      // that renders silence means either the wiring is wrong or the module is.
      expect(rms).toBeGreaterThan(0.01);
      // And that it is not so loud it is clipping, which would teach a bad default.
      expect(peak).toBeLessThanOrEqual(1);
    },
  );

  it.each(examples.map((e) => [e.moduleId, e] as const))(
    "%s uses the module it claims to demonstrate",
    (id, example) => {
      // An example for one module that never instantiates it is a documentation bug that no amount of
      // listening would catch.
      expect(example.patch.modules.map((m) => m.type)).toContain(id);
    },
  );
});
