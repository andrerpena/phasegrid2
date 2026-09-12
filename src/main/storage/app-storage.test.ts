import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readSetting, writeSetting } from "./app-storage";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pg-storage-"));
});

describe("application settings on disk", () => {
  it("round-trips a value", async () => {
    await writeSetting(dir, "layout", '{"a":1}');
    const read = await readSetting(dir, "layout");
    expect(read).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("treats an absent file as absent, not as a failure", async () => {
    // The first run has nothing stored. Reporting that as an error would put a warning in front of
    // every new user for the most ordinary situation there is.
    expect(await readSetting(dir, "workspace")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("keeps each key in its own file, so one cannot corrupt another", async () => {
    await writeSetting(dir, "layout", "config-text");
    await writeSetting(dir, "workspace", "keys-text");
    expect((await readSetting(dir, "layout")) as unknown).toEqual({
      ok: true,
      value: "config-text",
    });
    expect((await readSetting(dir, "workspace")) as unknown).toEqual({
      ok: true,
      value: "keys-text",
    });
  });

  it("replaces a value rather than appending to it", async () => {
    await writeSetting(dir, "layout", "first");
    await writeSetting(dir, "layout", "second");
    expect(await readSetting(dir, "layout")).toEqual({
      ok: true,
      value: "second",
    });
  });

  it("leaves no temporary file behind", async () => {
    // The write goes through a temporary and a rename, because writing in place leaves a window where
    // the file exists but is truncated. The temporary must not survive a successful write.
    await writeSetting(dir, "layout", "value");
    const stray = join(dir, "settings", "config.json.tmp");
    await expect(readFile(stray, "utf8")).rejects.toThrow();
  });

  it("reports a failure rather than throwing", async () => {
    // A directory where the file should be: unreadable, and the caller has to hear about it as data.
    const blocked = join(dir, "settings");
    await writeSetting(dir, "layout", "x");
    await writeFile(join(blocked, "keybindings.json"), "");
    const result = await writeSetting(
      join(dir, "settings", "keybindings.json"),
      "layout",
      "x",
    );
    expect(result.ok).toBe(false);
  });
});
