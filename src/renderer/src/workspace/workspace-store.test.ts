import { usePatchStore } from "@renderer/patch/patch-store";
import { emptyProject, useProjectStore } from "@renderer/project/project-store";
import { EMPTY_PATCH } from "@shared/protocol/patch";
import type { ProjectDoc } from "@shared/protocol/project";
import type { ProjectSummary } from "@shared/protocol/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "./workspace-store";

/**
 * A workspace made of objects rather than folders.
 *
 * The store's job is deciding what to write and where; whether the bytes land is `workspace-fs`'s job
 * and has its own tests against a real directory. Keeping them apart is what makes these fast enough to
 * be worth having.
 */
const disk = {
  current: null as { root: string; name: string } | null,
  recent: [] as string[],
  settings: null as string | null,
  session: null as string | null,
  projects: new Map<string, string>(),
  confirmDelete: true,
  failWrites: false,
};

function project(over: Partial<ProjectDoc> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: "saved-id",
    name: "Saved",
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    scale: { root: 0, name: "chromatic" },
    patch: EMPTY_PATCH,
    kind: "user",
    ...over,
  });
}

const ok = <T>(value: T) => ({ ok: true as const, value });

beforeEach(() => {
  disk.current = null;
  disk.recent = [];
  disk.settings = null;
  disk.session = null;
  disk.projects = new Map();
  disk.confirmDelete = true;
  disk.failWrites = false;

  vi.stubGlobal("window", {
    workspace: {
      current: async () => ok(disk.current),
      recent: async () => ok(disk.recent),
      choose: async () => ok(disk.current),
      openAt: async (root: string) =>
        disk.current === null
          ? { ok: false as const, error: "not a workspace" }
          : ok({ root, name: disk.current.name }),
      readSettings: async () => ok(disk.settings),
      writeSettings: async (text: string) => {
        disk.settings = text;
        return ok(undefined);
      },
      listProjects: async () =>
        ok(
          [...disk.projects.entries()].map(
            ([slug, text]): ProjectSummary => ({
              slug,
              name: JSON.parse(text).name,
              updatedAt: 0,
            }),
          ),
        ),
      readProject: async (slug: string) => {
        const text = disk.projects.get(slug);
        return text === undefined
          ? { ok: false as const, error: `no such project: ${slug}` }
          : ok(text);
      },
      writeProject: async (slug: string, text: string) => {
        if (disk.failWrites) return { ok: false as const, error: "disk full" };
        disk.projects.set(slug, text);
        return ok(undefined);
      },
      deleteProject: async (slug: string) => {
        disk.projects.delete(slug);
        return ok(undefined);
      },
      readSession: async () => ok(disk.session),
      writeSession: async (text: string) => {
        disk.session = text;
        return ok(undefined);
      },
      confirmDelete: async () => ok(disk.confirmDelete),
      confirmUnsaved: async () => ok("discard" as const),
      allowClose: async () => ok(undefined),
      onConfirmClose: () => () => {},
    },
  });

  useWorkspaceStore.setState({
    status: "booting",
    root: null,
    name: "",
    projects: [],
    recent: [],
    error: null,
  });
  useProjectStore.setState({ projects: [], activeId: null, dirtyIds: [] });
  usePatchStore.setState({ doc: EMPTY_PATCH, version: 0 });
});

describe("starting up", () => {
  it("shows the gate when no workspace has ever been picked", async () => {
    await useWorkspaceStore.getState().boot();
    expect(useWorkspaceStore.getState().status).toBe("unset");
  });

  it("reopens the workspace it remembers", async () => {
    disk.current = { root: "/w", name: "my-workspace" };
    disk.projects.set("saved", project());
    await useWorkspaceStore.getState().boot();
    const state = useWorkspaceStore.getState();
    expect(state.status).toBe("ready");
    expect(state.name).toBe("my-workspace");
    expect(state.projects.map((p) => p.slug)).toEqual(["saved"]);
  });

  it("reopens the tabs that were open", async () => {
    disk.current = { root: "/w", name: "w" };
    disk.projects.set("saved", project());
    disk.session = JSON.stringify({
      schemaVersion: 1,
      open: ["saved"],
      active: "saved",
    });
    await useWorkspaceStore.getState().boot();
    const open = useProjectStore.getState();
    expect(open.projects.map((p) => p.slug)).toEqual(["saved"]);
    expect(open.projects[0]?.id).toBe(open.activeId);
    // A reopened project is not an unsaved one.
    expect(open.dirtyIds).toEqual([]);
  });

  it("survives a session naming a project that is no longer there", async () => {
    disk.current = { root: "/w", name: "w" };
    disk.session = JSON.stringify({
      schemaVersion: 1,
      open: ["deleted"],
      active: "deleted",
    });
    await useWorkspaceStore.getState().boot();
    expect(useWorkspaceStore.getState().status).toBe("ready");
    expect(useProjectStore.getState().projects).toEqual([]);
  });
});

describe("opening a project", () => {
  it("reads it, and files it under the folder it came from", async () => {
    disk.current = { root: "/w", name: "w" };
    await useWorkspaceStore.getState().boot();
    disk.projects.set("elsewhere", project({ slug: "stale" }));
    expect(await useWorkspaceStore.getState().openProject("elsewhere")).toBe(
      true,
    );
    // Whatever the file claims about where it lives, the folder it was read from is the answer.
    expect(useProjectStore.getState().projects[0]?.slug).toBe("elsewhere");
  });

  it("refuses a file it cannot make sense of, without losing the workspace", async () => {
    disk.current = { root: "/w", name: "w" };
    await useWorkspaceStore.getState().boot();
    disk.projects.set("broken", "{ not json");
    expect(await useWorkspaceStore.getState().openProject("broken")).toBe(
      false,
    );
    expect(useWorkspaceStore.getState().error).toContain("broken");
    expect(useWorkspaceStore.getState().status).toBe("ready");
  });
});

describe("saving", () => {
  beforeEach(async () => {
    disk.current = { root: "/w", name: "w" };
    await useWorkspaceStore.getState().boot();
  });

  it("files a new project under its own name, without asking", async () => {
    const doc = emptyProject("My Track");
    useProjectStore.getState().open(doc);
    useProjectStore.getState().markDirty(doc.id);
    expect(await useWorkspaceStore.getState().saveProject(doc.id)).toBe(true);
    expect([...disk.projects.keys()]).toEqual(["my-track"]);
    expect(useProjectStore.getState().isDirty(doc.id)).toBe(false);
    expect(useProjectStore.getState().projects[0]?.slug).toBe("my-track");
  });

  it("writes the live patch, not the record's stale copy", async () => {
    const doc = emptyProject("My Track");
    useProjectStore.getState().open(doc);
    usePatchStore
      .getState()
      .apply([{ op: "moduleAdd", id: "osc", type: "osc.sine" }]);
    await useWorkspaceStore.getState().saveProject(doc.id);
    const written = JSON.parse(disk.projects.get("my-track") ?? "");
    expect(written.patch.modules.map((m: { id: string }) => m.id)).toEqual([
      "osc",
    ]);
  });

  it("does not write where the project lives into the project", async () => {
    // The folder is the only record of that. A second copy inside the file is a second answer that a
    // rename would make wrong.
    const doc = emptyProject("My Track");
    useProjectStore.getState().open(doc);
    await useWorkspaceStore.getState().saveProject(doc.id);
    expect(
      JSON.parse(disk.projects.get("my-track") ?? "").slug,
    ).toBeUndefined();
  });

  it("saves back to where it came from the second time", async () => {
    const doc = emptyProject("My Track");
    useProjectStore.getState().open(doc);
    await useWorkspaceStore.getState().saveProject(doc.id);
    useProjectStore.getState().setTempo(140);
    await useWorkspaceStore.getState().saveProject(doc.id);
    expect([...disk.projects.keys()]).toEqual(["my-track"]);
    expect(JSON.parse(disk.projects.get("my-track") ?? "").tempo).toBe(140);
  });

  it("never lands on top of another project", async () => {
    disk.projects.set("my-track", project({ name: "My Track" }));
    await useWorkspaceStore.getState().refresh();
    const doc = emptyProject("My Track");
    useProjectStore.getState().open(doc);
    await useWorkspaceStore.getState().saveProject(doc.id);
    expect([...disk.projects.keys()].sort()).toEqual([
      "my-track",
      "my-track-2",
    ]);
  });

  it("turns an example into a project when it is saved under a name", async () => {
    const example: ProjectDoc = { ...emptyProject("Sine"), kind: "example" };
    useProjectStore.getState().open(example);
    expect(useProjectStore.getState().canSave(example.id)).toBe(false);
    await useWorkspaceStore.getState().saveProjectAs(example.id, "My Sine");
    const saved = useProjectStore.getState().projects[0];
    expect(saved?.kind).toBe("user");
    expect(saved?.name).toBe("My Sine");
    expect(saved?.slug).toBe("my-sine");
    expect(JSON.parse(disk.projects.get("my-sine") ?? "").kind).toBe("user");
  });

  it("keeps the project dirty when the write fails", async () => {
    // The mark is the only thing standing between the person and losing the work. It must survive a
    // failed save, or a full disk becomes a silent one.
    const doc = emptyProject("My Track");
    useProjectStore.getState().open(doc);
    useProjectStore.getState().markDirty(doc.id);
    disk.failWrites = true;
    expect(await useWorkspaceStore.getState().saveProject(doc.id)).toBe(false);
    expect(useProjectStore.getState().isDirty(doc.id)).toBe(true);
    expect(useWorkspaceStore.getState().error).toBe("disk full");
  });

  it("refuses an empty name rather than filing something under nothing", async () => {
    const doc = emptyProject("My Track");
    useProjectStore.getState().open(doc);
    expect(
      await useWorkspaceStore.getState().saveProjectAs(doc.id, "   "),
    ).toBe(false);
    expect(disk.projects.size).toBe(0);
  });
});

describe("deleting", () => {
  beforeEach(async () => {
    disk.current = { root: "/w", name: "w" };
    disk.projects.set("saved", project());
    await useWorkspaceStore.getState().boot();
  });

  it("removes it once, after asking", async () => {
    await useWorkspaceStore.getState().removeProject("saved");
    expect(disk.projects.size).toBe(0);
    expect(useWorkspaceStore.getState().projects).toEqual([]);
  });

  it("does nothing when the answer is no", async () => {
    disk.confirmDelete = false;
    await useWorkspaceStore.getState().removeProject("saved");
    expect(disk.projects.size).toBe(1);
  });

  it("keeps an open tab, as a project that has never been saved", async () => {
    // Deleting the file is not a reason to throw away what is on screen.
    await useWorkspaceStore.getState().openProject("saved");
    const id = useProjectStore.getState().projects[0]?.id ?? "";
    await useWorkspaceStore.getState().removeProject("saved");
    const tab = useProjectStore.getState().projects[0];
    expect(tab?.id).toBe(id);
    expect(tab?.slug).toBeUndefined();
    expect(useProjectStore.getState().isDirty(id)).toBe(true);
  });
});
