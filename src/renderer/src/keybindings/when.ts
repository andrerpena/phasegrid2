/**
 * A tiny expression language for deciding whether a keybinding applies.
 *
 * `focus == "grid" && !modalOpen`. Nothing more: no arithmetic, no function calls, no property paths.
 * The whole point is that a `when` clause is read at a glance and cannot do anything surprising, since
 * these come from a user-editable keybindings file.
 *
 * Grammar, loosest to tightest:
 *   or   := and ("||" and)*
 *   and  := not ("&&" not)*
 *   not  := "!" not | comparison
 *   comp := atom (("==" | "!=") atom)?
 *   atom := "(" or ")" | identifier | string | true | false
 */

export type WhenContext = Record<string, string | boolean | number | undefined>;

type Token = { kind: "op" | "name" | "string" | "paren"; text: string };

const OPERATORS = ["&&", "||", "==", "!=", "!", "(", ")"];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = source.indexOf(c, i + 1);
      if (end < 0)
        throw new Error(`unterminated string in when clause: ${source}`);
      tokens.push({ kind: "string", text: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (op) {
      tokens.push({
        kind: op === "(" || op === ")" ? "paren" : "op",
        text: op,
      });
      i += op.length;
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(i));
    if (!match)
      throw new Error(`unexpected character '${c}' in when clause: ${source}`);
    tokens.push({ kind: "name", text: match[0] });
    i += match[0].length;
  }
  return tokens;
}

/** Compiles once so a keybinding evaluated on every keystroke is not re-parsed on every keystroke. */
export function compileWhen(source: string): (context: WhenContext) => boolean {
  const tokens = tokenize(source);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const eat = (text: string): boolean => {
    if (peek()?.text === text) {
      pos++;
      return true;
    }
    return false;
  };

  type Node = (c: WhenContext) => string | boolean | number | undefined;

  function atom(): Node {
    const token = tokens[pos];
    if (token === undefined)
      throw new Error(`unexpected end of when clause: ${source}`);
    if (token.text === "(") {
      pos++;
      const inner = or();
      if (!eat(")")) throw new Error(`missing ')' in when clause: ${source}`);
      return inner;
    }
    pos++;
    if (token.kind === "string") return () => token.text;
    if (token.text === "true") return () => true;
    if (token.text === "false") return () => false;
    // An unset key reads as undefined, which is falsy and compares unequal to everything. A clause
    // mentioning a key the context does not have is therefore false rather than an error: contexts grow
    // over time and an old keybindings file should not stop the application from starting.
    return (c) => c[token.text];
  }

  function comparison(): Node {
    const left = atom();
    if (eat("==")) {
      const right = atom();
      return (c) => left(c) === right(c);
    }
    if (eat("!=")) {
      const right = atom();
      return (c) => left(c) !== right(c);
    }
    return left;
  }

  function not(): Node {
    if (eat("!")) {
      const inner = not();
      return (c) => !inner(c);
    }
    return comparison();
  }

  function and(): Node {
    let left = not();
    while (eat("&&")) {
      const right = not();
      const l = left;
      left = (c) => Boolean(l(c)) && Boolean(right(c));
    }
    return left;
  }

  function or(): Node {
    let left = and();
    while (eat("||")) {
      const right = and();
      const l = left;
      left = (c) => Boolean(l(c)) || Boolean(right(c));
    }
    return left;
  }

  const root = or();
  if (pos !== tokens.length)
    throw new Error(`trailing input in when clause: ${source}`);
  return (context) => Boolean(root(context));
}

/** Evaluates once. A clause that does not parse is false, and says so, rather than throwing at a keystroke. */
export function evaluateWhen(source: string, context: WhenContext): boolean {
  try {
    return compileWhen(source)(context);
  } catch {
    return false;
  }
}
