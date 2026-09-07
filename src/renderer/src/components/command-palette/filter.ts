import type { CommandDefinition } from "@renderer/commands/types";

/**
 * Ranks commands against what has been typed.
 *
 * Subsequence matching rather than substring, so "pam" finds "patch.addModule": people type the letters
 * they remember, not a prefix. A pure function so the ranking is testable, which matters because
 * "obviously right" ranking rules are the ones that turn out to bury the command everyone wants.
 */

export interface Ranked {
  command: CommandDefinition<never>;
  score: number;
  /** Which characters of the label matched, for highlighting. */
  matched: number[];
}

/**
 * Where the query's letters appear in the target, in order, or null.
 *
 * Consecutive matches and matches at word boundaries score higher, because "add" should rank
 * `patch.addModule` above a command that merely contains a, d and d scattered through it.
 */
function subsequence(
  query: string,
  target: string,
): { score: number; matched: number[] } | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const matched: number[] = [];
  let score = 0;
  let ti = 0;
  let previous = -2;
  for (const char of q) {
    const found = t.indexOf(char, ti);
    if (found < 0) return null;
    matched.push(found);
    if (found === previous + 1) score += 3;
    if (found === 0 || ".- ".includes(t[found - 1] ?? "")) score += 4;
    previous = found;
    ti = found + 1;
  }
  // Shorter targets win ties: an exact-length match is more likely what was meant than a long name
  // that happens to contain the same letters.
  return { score: score - t.length * 0.01, matched };
}

export function rankCommands(
  commands: CommandDefinition<never>[],
  query: string,
): Ranked[] {
  const trimmed = query.trim();
  if (trimmed === "")
    return commands
      .map((command) => ({ command, score: 0, matched: [] }))
      .slice(0, 50);

  const ranked: Ranked[] = [];
  for (const command of commands) {
    // The visible name is tried first; the id is a fallback so someone who knows the id can type it.
    const byName = subsequence(trimmed, command.name);
    const byId = subsequence(trimmed, command.id);
    const best =
      byName === null
        ? byId
        : byId === null
          ? byName
          : byName.score >= byId.score
            ? byName
            : byId;
    if (best === null) continue;
    ranked.push({
      command,
      score: best.score,
      matched: byName === best ? best.matched : [],
    });
  }
  return ranked.sort(
    (a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name),
  );
}
