import { ProjectDocSchema } from "@shared/protocol/project";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * What a project file may contain, as the editor understands it, generated from the same Zod schema
 * that validates one on the way in -- so the source view cannot underline something the application
 * would accept, or accept something it would refuse. Inlined (`$refStrategy: "none"`) for the same
 * reason the settings schema is: one self-contained document with nothing to resolve.
 */
export function getProjectJsonSchema(): object {
  return zodToJsonSchema(ProjectDocSchema, { $refStrategy: "none" });
}
