import type { MenuItem } from "../../menu/types";

/**
 * How a typed query orders a list of menu items.
 *
 * Kept out of the component because it is the part with the judgement in it, and the part worth
 * testing on its own. The component owns a text box and a highlight; this owns what "matching"
 * means.
 */

/**
 * Matches the query's characters in order rather than as a substring.
 *
 * People type what they remember, not a prefix: "adm" should find "Add Module". Consecutive matches
 * and matches at a word boundary score higher, so "add" ranks `Add Module` above something that
 * merely contains an a, a d and a d scattered through it.
 */
function score(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let total = 0;
  let at = 0;
  let previous = -2;
  for (const char of q) {
    const found = t.indexOf(char, at);
    if (found < 0) return null;
    if (found === previous + 1) total += 3;
    if (found === 0 || ".-_ /".includes(t[found - 1] ?? "")) total += 4;
    previous = found;
    at = found + 1;
  }
  // Shorter targets win ties: an exact-length match is likelier to be what was meant than a long name
  // that happens to contain the same letters.
  return total - t.length * 0.01;
}

/**
 * The fields are not equal, and weighting them is what makes the ranking usable.
 *
 * A label match is what someone meant. A subtitle match — the command's id, the module's type — is
 * deliberate too. Keywords are prose, and a subsequence of two or three letters can be found
 * scattered through almost any sentence, so an unweighted keyword match drowns the labels: typing
 * "os" put the flanger above the oscillator, because its description happened to contain an o and
 * then an s.
 *
 * Keywords still earn their place, because they are how you find something by what it does rather
 * than by its name. They just cannot outrank the thing actually called that.
 */
const SUBTITLE_WEIGHT = 0.8;
const KEYWORD_WEIGHT = 0.25;
/** Whatever the prose scored, it ends up below every name match. */
const KEYWORD_CEILING = -1;

/**
 * Ranks a flat list. An empty query keeps the list exactly as it was given, which is what lets a
 * grouped, deliberately-ordered menu survive until someone actually searches it.
 */
export function rankMenuItems(items: MenuItem[], query: string): MenuItem[] {
  const trimmed = query.trim();
  if (trimmed === "") return items;

  const ranked: { item: MenuItem; score: number }[] = [];
  for (const item of items) {
    const label = item.label === undefined ? null : score(trimmed, item.label);
    const subtitle =
      item.subtitle === undefined ? null : score(trimmed, item.subtitle);
    const keywords =
      item.keywords === undefined ? null : score(trimmed, item.keywords);

    const named = Math.max(
      label ?? Number.NEGATIVE_INFINITY,
      subtitle === null ? Number.NEGATIVE_INFINITY : subtitle * SUBTITLE_WEIGHT,
    );
    const best =
      named > Number.NEGATIVE_INFINITY
        ? named
        : keywords === null
          ? Number.NEGATIVE_INFINITY
          : Math.min(KEYWORD_CEILING, keywords * KEYWORD_WEIGHT);

    if (best > Number.NEGATIVE_INFINITY) ranked.push({ item, score: best });
  }

  return ranked
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.item.label ?? "").localeCompare(b.item.label ?? ""),
    )
    .map((r) => r.item);
}

/**
 * Flattens a tree so a search reaches items nested under a collapsed parent.
 *
 * A parent that matches is kept without its children, because the children are about to appear in
 * the same flat list on their own account and listing them twice reads as a duplicate.
 */
export function flattenForSearch(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const item of items) {
    out.push({ ...item, children: undefined });
    if (item.children !== undefined)
      out.push(...flattenForSearch(item.children));
  }
  return out;
}
