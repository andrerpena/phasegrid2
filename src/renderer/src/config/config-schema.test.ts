import { describe, expect, it } from "vitest";
import {
  ConfigOverridesSchema,
  getConfigJsonSchema,
  knownColourPaths,
} from "./config-schema";
import { CONFIG_SCHEMA } from "./defaults";

const parse = (value: unknown) => ConfigOverridesSchema.safeParse(value);

describe("validating settings", () => {
  it("accepts an empty object", () => {
    expect(parse({}).success).toBe(true);
  });

  it("accepts the settings it documents", () => {
    expect(
      parse({
        "grid.snap": 16,
        "grid.showParamPorts": "always",
        "engine.blockSize": 128,
        theme: { "grid.gridLine": "#ff0000" },
        keybindings: [{ key: "mod+j", command: "workbench.setTheme" }],
      }).success,
    ).toBe(true);
  });

  it("refuses a key it does not know", () => {
    // Almost always a misspelling of a real one, and a misspelling that validated would be a
    // setting that looks set and is not.
    const result = parse({ "grid.snapp": 8 });
    expect(result.success).toBe(false);
  });

  it("refuses a value out of range", () => {
    expect(parse({ "grid.snap": 0 }).success).toBe(false);
    expect(parse({ "engine.voiceCount": 999 }).success).toBe(false);
  });

  it("refuses a panel this build does not have", () => {
    expect(parse({ "layout.widgets": { center: ["grid"] } }).success).toBe(
      true,
    );
    expect(parse({ "layout.widgets": { center: ["nonesuch"] } }).success).toBe(
      false,
    );
  });

  it("refuses a slot that is not a slot", () => {
    expect(parse({ "layout.widgets": { middle: ["grid"] } }).success).toBe(
      false,
    );
  });

  it("takes a colour path it has never heard of", () => {
    // Open on purpose: a settings file written against a build with one more signal role in it
    // should lose nothing.
    expect(parse({ theme: { "signal.something": "#abcdef" } }).success).toBe(
      true,
    );
  });

  it("says where the problem is", () => {
    const result = parse({ "grid.snap": "eight" });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path.join(".")).toBe("grid.snap");
  });
});

describe("the schema the editor completes against", () => {
  const json = getConfigJsonSchema() as {
    properties: Record<
      string,
      { properties?: Record<string, unknown>; description?: string }
    >;
  };
  const properties = json.properties;

  it("describes every setting", () => {
    for (const key of Object.keys(CONFIG_SCHEMA)) {
      expect(properties[key], key).toBeDefined();
      expect(properties[key]?.description, key).toBeTruthy();
    }
  });

  it("offers the colour paths this build knows", () => {
    const offered = properties.theme?.properties ?? {};
    expect(Object.keys(offered)).toContain("grid.gridLine");
    expect(Object.keys(offered)).toContain("signal.audio");
    expect(Object.keys(offered)).toContain("ui.background");
    // Every offered path has the theme's own value as its default, so the tooltip says what it is
    // overriding rather than only that it can be.
    for (const { path, value } of knownColourPaths())
      expect((offered[path] as { default?: string }).default, path).toBe(value);
  });

  // One self-contained schema with nothing to resolve. A `$ref` is a URL to the language client,
  // and the one it would resolve against is not served here.
  it("has nothing to resolve", () => {
    expect(JSON.stringify(json)).not.toContain('"$ref"');
  });
});
