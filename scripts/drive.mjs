#!/usr/bin/env node
/**
 * Drives an application that is already running: a development session started with a debugging
 * port, or an e2e run kept alive with --keep.
 *
 *   npm run dev:drive                                       # the app, silent, listening on 9222
 *   node scripts/drive.mjs 'pg.snapshot().engine'           # one expression, printed as JSON
 *   node scripts/drive.mjs 'pg.commands.run("project.new")'
 *   node scripts/drive.mjs --text                           # the window's text
 *   node scripts/drive.mjs --shot /tmp/now.png              # a picture (2x on a retina display)
 *   node scripts/drive.mjs                                  # a REPL: one expression per line
 *   node scripts/drive.mjs --port 9401 ...                  # somewhere other than 9222
 *
 * The expression runs inside the page with `pg` (the automation API) and the `window.*` bridges in
 * scope, and is awaited, so `pg.idle()` and `window.engine.call(...)` both work as written.
 */
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { connect, findPage } from "./e2e/cdp.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  if (at < 0) return null;
  const value = argv[at + 1] ?? null;
  argv.splice(at, value === null ? 1 : 2);
  return value;
};
const port = Number(flag("--port") ?? 9222);
const shot = flag("--shot");
const wantText = argv.includes("--text");
if (wantText) argv.splice(argv.indexOf("--text"), 1);
const expression = argv.join(" ").trim();

const url = await findPage(port, 4, 250);
if (url === null) {
  console.error(
    `nothing is listening on port ${port}. Start the app with:\n  npm run dev:drive\nor add --remote-debugging-port=${port} to its arguments.`,
  );
  process.exit(2);
}
const cdp = await connect(url, {
  onConsole: (type, text) => console.error(`[page:${type}] ${text}`),
});

const run = async (source) => {
  const value = await cdp.evaluate(`const pg = window.pg; return (${source});`);
  return value;
};
const print = (value) =>
  console.log(
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );

try {
  if (shot !== null) {
    const reply = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(shot, Buffer.from(reply.result.data, "base64"));
    console.log(`wrote ${shot}`);
  }
  if (wantText) print(await run("document.body.innerText"));
  if (expression !== "") print(await run(expression));
  if (shot === null && !wantText && expression === "") {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "pg> ",
    });
    rl.prompt();
    for await (const line of rl) {
      if (line.trim() !== "") {
        try {
          print(await run(line));
        } catch (error) {
          console.error(error.message);
        }
      }
      rl.prompt();
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  cdp.close();
}
