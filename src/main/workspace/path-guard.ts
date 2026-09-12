import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSlug } from "../../../shared/protocol/workspace";

/**
 * The one place that decides where a file may be written.
 *
 * The renderer names a project by its slug and never by a path, so every filesystem call in the
 * workspace passes through here. It is checked even though the renderer is ours: IPC is a boundary, and
 * a boundary that trusts its input because of where the input came from is not a boundary. A compromised
 * or simply buggy renderer must not be able to name `../../../.ssh/id_rsa`.
 *
 * What a slug may be is defined in the shared protocol, because the renderer has to be able to make one
 * that this will accept, and two copies of that rule would eventually disagree.
 */

/**
 * Resolves a path under `root`, throwing if the result escapes it.
 *
 * The containment test is on the resolved relative path rather than on a string prefix, because
 * `/w/workspace-evil` starts with `/w/workspace` and a prefix comparison would wave it through.
 */
export function resolveInside(root: string, ...segments: string[]): string {
  const base = resolve(root);
  const target = resolve(base, join(...segments));
  const rel = relative(base, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`path escapes the workspace: ${segments.join("/")}`);
  // A separator inside the relative path is fine — `projects/x/project.json` has two — but a leading
  // `..` component is not, and `relative` puts those at the front where the check above sees them.
  if (rel.split(sep).includes(".."))
    throw new Error(`path escapes the workspace: ${segments.join("/")}`);
  return target;
}

/** The path of a project's folder, refusing anything that is not a slug before it touches the disk. */
export function projectDir(root: string, slug: string, dir: string): string {
  if (!isSlug(slug)) throw new Error(`not a project name: ${slug}`);
  return resolveInside(root, dir, slug);
}
