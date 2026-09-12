/**
 * A keystroke, written the way the platform writes it.
 *
 * `mod+shift+k` is the storage form — one string that means command on a Mac and control everywhere
 * else. This turns it into what belongs on a menu row: `⇧⌘K` on a Mac, `Ctrl+Shift+K` elsewhere.
 * Purely presentational; nothing matches against the result.
 */

const MAC_SYMBOLS: Record<string, string> = {
  mod: "⌘",
  meta: "⌘",
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
};

const OTHER_NAMES: Record<string, string> = {
  mod: "Ctrl",
  meta: "Win",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
};

/** Named keys that read better than their raw form. */
const KEY_NAMES: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "↵",
  escape: "Esc",
  backspace: "⌫",
  delete: "Del",
  " ": "Space",
  space: "Space",
};

/** Modifier order is the platform's convention, not the order they were typed. */
const MAC_ORDER = ["ctrl", "alt", "shift", "mod", "meta"];
const OTHER_ORDER = ["ctrl", "mod", "alt", "shift", "meta"];

export function formatKey(key: string, isMac = detectMac()): string {
  const parts = key.split("+");
  const last = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1).map((m) => m.toLowerCase());

  const order = isMac ? MAC_ORDER : OTHER_ORDER;
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  const table = isMac ? MAC_SYMBOLS : OTHER_NAMES;
  const rendered = modifiers.map((m) => table[m] ?? m);

  const lower = last.toLowerCase();
  const name =
    KEY_NAMES[lower] ??
    (last.length === 1 ? last.toUpperCase() : capitalise(last));

  // A Mac stacks the symbols with nothing between them; everywhere else joins with a plus.
  return isMac ? [...rendered, name].join("") : [...rendered, name].join("+");
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function detectMac(): boolean {
  // `navigator` is absent in tests and in the main process; assume the majority platform there,
  // since the only consequence is how a hint reads.
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  );
}
