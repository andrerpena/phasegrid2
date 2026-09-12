import { type ProjectDoc, ProjectDocSchema } from "@shared/protocol/project";

/**
 * The text of a project file, from the document.
 *
 * One function, used by the save path and by the source view, so what the view shows is exactly what
 * Save writes: `slug` left out because the folder already says where the project lives, the rest
 * passed through the schema so defaults are filled and nothing the schema does not know leaks into
 * the file, then pretty-printed with a trailing newline.
 */
export function projectText(
  doc: ProjectDoc,
): { ok: true; text: string } | { ok: false; error: string } {
  const { slug: _slug, ...payload } = doc;
  const validated = ProjectDocSchema.safeParse(payload);
  if (!validated.success) return { ok: false, error: validated.error.message };
  return { ok: true, text: `${JSON.stringify(validated.data, null, 2)}\n` };
}
