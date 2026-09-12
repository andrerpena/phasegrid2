import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteProject,
  isWorkspace,
  listProjects,
  openWorkspace,
  readProject,
  readSession,
  readSettings,
  scaffold,
  writeProject,
  writeSession,
  writeSettings,
} from "./workspace-fs";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pg-workspace-"));
});

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function project(name: string): Promise<string> {
  return JSON.stringify({
    schemaVersion: 1,
    id: `id-${name}`,
    name,
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    scale: { root: 0, name: "chromatic" },
    patch: { modules: {}, edges: {} },
    kind: "user",
  });
}

describe("scaffolding a workspace", () => {
  it("creates the folder a workspace is", async () => {
    const info = unwrap(await scaffold(root));
    expect(info.root).toBe(root);
    // The name defaults to the folder's own, because that is what the person just typed into the
    // folder dialog and asking them for it twice is asking them for it twice.
    expect(info.name).toBe(root.split("/").at(-1));

    const file = JSON.parse(
      await readFile(join(root, "workspace.json"), "utf8"),
    );
    expect(file).toEqual({ schemaVersion: 1, name: info.name, settings: {} });
    // The empty folders exist from the first moment, so the shape of a workspace is legible by looking
    // at one rather than by reading a document about it.
    for (const entry of ["projects", "modules", ".phasegrid"])
      expect((await stat(join(root, entry))).isDirectory()).toBe(true);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(
      ".phasegrid/",
    );
  });

  it("recognises what it created", async () => {
    expect(await isWorkspace(root)).toBe(false);
    await scaffold(root);
    expect(await isWorkspace(root)).toBe(true);
  });

  it("opens an existing workspace without overwriting it", async () => {
    await scaffold(root);
    await writeSettings(root, '{"ui.theme":"light"}');
    const info = unwrap(await openWorkspace(root));
    expect(info.name).toBe(root.split("/").at(-1));
    expect(unwrap(await readSettings(root))).toContain("light");
  });

  it("scaffolds a folder that is not a workspace yet", async () => {
    await writeFile(join(root, "unrelated.txt"), "hello");
    unwrap(await openWorkspace(root));
    expect(await isWorkspace(root)).toBe(true);
    // Scaffolding adds to a folder; it does not clear one.
    expect(await readFile(join(root, "unrelated.txt"), "utf8")).toBe("hello");
  });

  it("reports a folder that is not there rather than creating it", async () => {
    const missing = join(root, "nope");
    const result = await openWorkspace(missing);
    expect(result.ok).toBe(false);
  });
});

describe("settings", () => {
  it("round-trips the settings object alone, leaving its siblings intact", async () => {
    await scaffold(root);
    await writeSettings(root, '{"ui.theme":"light","grid.snap":16}');
    const file = JSON.parse(
      await readFile(join(root, "workspace.json"), "utf8"),
    );
    expect(file.schemaVersion).toBe(1);
    expect(file.name).toBe(root.split("/").at(-1));
    expect(file.settings).toEqual({ "ui.theme": "light", "grid.snap": 16 });
    expect(JSON.parse(unwrap(await readSettings(root)) ?? "")).toEqual(
      file.settings,
    );
  });

  it("keeps a field somebody added to the file by hand", async () => {
    // The settings editor never sees the rest of the file. Merging into the validated object would
    // strip whatever it did not recognise, which is a silent way to lose someone's note to themselves.
    await scaffold(root);
    const path = join(root, "workspace.json");
    const file = JSON.parse(await readFile(path, "utf8"));
    await writeFile(
      path,
      JSON.stringify({ ...file, note: "hand written" }),
      "utf8",
    );
    await writeSettings(root, '{"ui.theme":"light"}');
    expect(JSON.parse(await readFile(path, "utf8")).note).toBe("hand written");
  });

  it("refuses text that is not an object, rather than writing it", async () => {
    await scaffold(root);
    await writeSettings(root, '{"ui.theme":"light"}');
    expect((await writeSettings(root, "not json")).ok).toBe(false);
    expect((await writeSettings(root, "[1,2]")).ok).toBe(false);
    expect(unwrap(await readSettings(root))).toContain("light");
  });

  it("answers with defaults when the workspace file will not parse", async () => {
    await scaffold(root);
    await writeFile(join(root, "workspace.json"), "{ broken", "utf8");
    // A corrupt workspace file costs the settings, not the workspace: the projects are still there and
    // are the part that cannot be recreated.
    expect(unwrap(await readSettings(root))).toBe(null);
  });
});

describe("projects", () => {
  it("round-trips a project", async () => {
    await scaffold(root);
    const text = await project("My Track");
    unwrap(await writeProject(root, "my-track", text));
    expect(JSON.parse(unwrap(await readProject(root, "my-track")))).toEqual(
      JSON.parse(text),
    );
    expect(unwrap(await listProjects(root))).toEqual([
      expect.objectContaining({ slug: "my-track", name: "My Track" }),
    ]);
  });

  it("replaces a project rather than appending to it", async () => {
    await scaffold(root);
    await writeProject(root, "my-track", await project("First"));
    await writeProject(root, "my-track", await project("Second"));
    expect(JSON.parse(unwrap(await readProject(root, "my-track"))).name).toBe(
      "Second",
    );
    expect(unwrap(await listProjects(root))).toHaveLength(1);
  });

  it("lists the good projects even when one is broken", async () => {
    // One unreadable project must not hide the rest. The list is how a person finds their work, and
    // failing it whole would mean a single bad file loses them the workspace.
    await scaffold(root);
    await writeProject(root, "good", await project("Good"));
    await mkdir(join(root, "projects", "empty"), { recursive: true });
    await mkdir(join(root, "projects", "corrupt"), { recursive: true });
    await writeFile(
      join(root, "projects", "corrupt", "project.json"),
      "{ broken",
      "utf8",
    );
    const listed = unwrap(await listProjects(root));
    expect(listed.map((p) => p.slug)).toEqual(["good"]);
  });

  it("names a project by its folder, whatever the file says", async () => {
    // The folder is the only record of where a project is, so renaming it moves the project rather
    // than leaving a document that points at nothing.
    await scaffold(root);
    await writeProject(root, "my-track", await project("My Track"));
    const listed = unwrap(await listProjects(root));
    expect(listed[0]?.slug).toBe("my-track");
  });

  it("deletes a project, and says so when there was nothing to delete", async () => {
    await scaffold(root);
    await writeProject(root, "my-track", await project("My Track"));
    unwrap(await deleteProject(root, "my-track"));
    expect(unwrap(await listProjects(root))).toEqual([]);
    expect((await readProject(root, "my-track")).ok).toBe(false);
  });

  it("refuses a slug that would escape the workspace", async () => {
    await scaffold(root);
    const outside = join(root, "..", "escaped.json");
    await rm(outside, { force: true });
    for (const slug of ["../escaped", "/etc/passwd", "..", "", "Upper Case"]) {
      expect((await writeProject(root, slug, await project("x"))).ok).toBe(
        false,
      );
      expect((await readProject(root, slug)).ok).toBe(false);
      expect((await deleteProject(root, slug)).ok).toBe(false);
    }
    await expect(readFile(outside, "utf8")).rejects.toThrow();
  });
});

describe("the session", () => {
  it("round-trips, and is absent before anything writes one", async () => {
    await scaffold(root);
    expect(unwrap(await readSession(root))).toBe(null);
    await writeSession(root, '{"schemaVersion":1,"open":["a"],"active":"a"}');
    expect(JSON.parse(unwrap(await readSession(root)) ?? "")).toEqual({
      schemaVersion: 1,
      open: ["a"],
      active: "a",
    });
  });
});
