#!/usr/bin/env node
// Trademark guard promised by docs/superpowers/specs/2026-09-07-vital-native-core-amendment.md
// ("Licensing and naming"): our own sources must never carry the upstream project's name or its
// author's name into ids, UI strings or shipped binaries.
//
// A blanket grep would fail on the legitimate uses that the vendoring decision forces on us, so a
// hit is allowed only when it is one of:
//   1. a C++ namespace qualification (`vital::something`),
//   2. an `#include` of a vendored header (the hit lies inside the include path),
//   3. a comment that names the vendored directory `engine/vendor/vital`.
// Everything else is a violation: printed as file:line and a non-zero exit.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["engine/src", "shared", "src"];
const VENDOR_DIR = "engine/vendor/vital";
const TERMS = /vital|tytel/gi;
const TEXT =
  /\.(c|cc|cpp|cxx|h|hpp|hxx|inl|ts|tsx|js|jsx|mjs|cjs|json|css|md|html|txt)$/i;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (TEXT.test(entry)) yield full;
  }
}

/** Byte range of the path inside an `#include "x"` / `#include <x>` line, or null. */
function includePathSpan(line) {
  const m = /^\s*#\s*include\s*[<"]/.exec(line);
  if (!m) return null;
  const start = m[0].length;
  const end = line.indexOf(m[0].endsWith("<") ? ">" : '"', start);
  return end < 0 ? null : { start, end };
}

const violations = [];
for (const rootRel of ROOTS) {
  const dir = join(root, rootRel);
  let files;
  try {
    files = [...walk(dir)];
  } catch {
    continue; // tree absent (e.g. shared/ before it exists)
  }
  for (const file of files) {
    let inBlockComment = false;
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [i, line] of lines.entries()) {
      // Where a comment starts on this line (block comments carry over between lines).
      const blockOpen = line.indexOf("/*");
      const blockClose = line.indexOf("*/");
      const lineComment = line.indexOf("//");
      let commentFrom = inBlockComment ? 0 : Number.POSITIVE_INFINITY;
      if (lineComment >= 0) commentFrom = Math.min(commentFrom, lineComment);
      if (!inBlockComment && blockOpen >= 0)
        commentFrom = Math.min(commentFrom, blockOpen);
      if (inBlockComment && blockClose >= 0 && blockOpen < 0)
        inBlockComment = false;
      else if (!inBlockComment && blockOpen >= 0 && blockClose < blockOpen)
        inBlockComment = true;

      const span = includePathSpan(line);
      TERMS.lastIndex = 0;
      for (let m = TERMS.exec(line); m; m = TERMS.exec(line)) {
        const at = m.index;
        if (line.startsWith("::", at + m[0].length)) continue; // vital::…
        if (span && at >= span.start && at < span.end) continue; // #include of a vendored header
        if (at >= commentFrom && line.includes(VENDOR_DIR)) continue; // comment naming the vendored dir
        violations.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
        break; // one report per line is enough
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `[check-trademark] ${violations.length} disallowed reference(s):`,
  );
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\nAllowed only as a \`vital::\` namespace qualification, an #include of a vendored header,\n` +
      `or a comment naming ${VENDOR_DIR}. See docs/engine.md.`,
  );
  process.exit(1);
}
console.log(`[check-trademark] ok: ${ROOTS.join(", ")} clean`);
