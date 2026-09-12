import { describe, expect, it } from "vitest";
import { parseLaunchOptions } from "./launch-options";

describe("launch options", () => {
  it("defaults to nothing asked for", () => {
    expect(parseLaunchOptions(["electron", "."])).toEqual({
      workspace: null,
      audio: null,
    });
  });

  it("reads a flag with a following value and with an inline one", () => {
    expect(
      parseLaunchOptions([".", "--workspace", "/tmp/ws", "--audio=null"]),
    ).toEqual({ workspace: "/tmp/ws", audio: "null" });
    expect(
      parseLaunchOptions([".", "--workspace=/tmp/ws", "--audio", "3"]),
    ).toEqual({ workspace: "/tmp/ws", audio: "3" });
  });

  it("ignores a flag with nothing after it", () => {
    // `--workspace` followed by another flag must not swallow the flag as a folder name.
    expect(
      parseLaunchOptions([".", "--workspace", "--remote-debugging-port=9222"]),
    ).toEqual({ workspace: null, audio: null });
    expect(parseLaunchOptions([".", "--audio"])).toEqual({
      workspace: null,
      audio: null,
    });
  });

  it("leaves Chromium's own flags alone", () => {
    expect(
      parseLaunchOptions([
        ".",
        "--remote-debugging-port=9222",
        "--user-data-dir=/tmp/ud",
        "--audio",
        "null",
      ]),
    ).toEqual({ workspace: null, audio: "null" });
  });

  it("takes the last of a repeated flag", () => {
    expect(
      parseLaunchOptions([".", "--audio", "1", "--audio", "null"]).audio,
    ).toBe("null");
  });
});
