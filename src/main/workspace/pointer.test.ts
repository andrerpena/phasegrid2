import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { writeSetting } from "../storage/app-storage";
import { readPointer, rememberWorkspace } from "./pointer";

let userData = "";
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pg-pointer-"));
});

describe("the workspace pointer", () => {
  it("starts empty", async () => {
    expect(await readPointer(userData)).toEqual({ path: null, recent: [] });
  });

  it("remembers the current workspace and its history", async () => {
    await rememberWorkspace(userData, "/w/one");
    await rememberWorkspace(userData, "/w/two");
    expect(await readPointer(userData)).toEqual({
      path: "/w/two",
      recent: ["/w/two", "/w/one"],
    });
  });

  it("moves a workspace you return to back to the front rather than listing it twice", async () => {
    await rememberWorkspace(userData, "/w/one");
    await rememberWorkspace(userData, "/w/two");
    await rememberWorkspace(userData, "/w/one");
    expect((await readPointer(userData)).recent).toEqual(["/w/one", "/w/two"]);
  });

  it("keeps the history short", async () => {
    for (let n = 0; n < 15; n++) await rememberWorkspace(userData, `/w/${n}`);
    const { recent } = await readPointer(userData);
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe("/w/14");
  });

  it("starts at the gate rather than failing when the file is corrupt", async () => {
    await writeSetting(userData, "workspace", "{ broken");
    expect(await readPointer(userData)).toEqual({ path: null, recent: [] });
  });
});
