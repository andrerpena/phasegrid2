import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Writes a file so that a reader never sees half of it.
 *
 * Writing in place leaves a window where the file exists but is truncated, and that window is exactly
 * when a crash or a power cut will find it. Rename is atomic within a filesystem, so the file is either
 * the old contents or the new one and never a mixture. Everything this application writes — settings,
 * projects, the session — goes through here.
 */
export async function writeFileAtomic(
  target: string,
  text: string,
): Promise<void> {
  const temporary = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, text, "utf8");
  await rename(temporary, target);
}
