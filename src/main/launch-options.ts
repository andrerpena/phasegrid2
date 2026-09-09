/**
 * What the command line asked for.
 *
 * Two flags of our own, beside Chromium's. Both exist so that a launch can be reproduced exactly:
 * a scripted run names the folder it works in and the audio device it plays through, and neither
 * choice leaks into what the person's next launch does.
 *
 * - `--workspace <dir>` opens that folder for this launch. It overrides the remembered pointer and is
 *   never written to it, so an automation run leaves the workspace you were in alone.
 * - `--audio <id|null>` chooses the engine's device. `null` is a silent backend with real-time timing,
 *   for machines with no sound hardware and for continuous integration.
 *
 * Parsed here and nowhere else: `process.argv` in an Electron main process carries the binary, the
 * app path and whatever Chromium consumed, and every module reading it directly would repeat the
 * same guesswork about where the flags start.
 */
export interface LaunchOptions {
  workspace: string | null;
  audio: string | null;
}

export function parseLaunchOptions(argv: readonly string[]): LaunchOptions {
  const options: LaunchOptions = { workspace: null, audio: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const [name, inline] = splitFlag(arg);
    if (name !== "--workspace" && name !== "--audio") continue;
    // `--flag=value` and `--flag value` both count; a flag with nothing after it is ignored rather
    // than treated as an empty value, which would open an empty path or ask for device "".
    const value = inline ?? argv[i + 1];
    if (value === undefined || value.startsWith("--")) continue;
    if (inline === undefined) i++;
    if (name === "--workspace") options.workspace = value;
    else options.audio = value;
  }
  return options;
}

function splitFlag(arg: string): [string, string | undefined] {
  const at = arg.indexOf("=");
  if (!arg.startsWith("--") || at < 0) return [arg, undefined];
  return [arg.slice(0, at), arg.slice(at + 1)];
}
