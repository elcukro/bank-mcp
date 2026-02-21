import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";

/**
 * Minimal Zod → JSON Schema converter for MCP tool inputSchema.
 *
 * Handles the subset we actually use: objects with string, number,
 * enum, and optional fields. No need for a full library.
 */
export function zodToJsonSchema(
  schema: ZodObject<ZodRawShape>,
): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, fieldDef] of Object.entries(shape)) {
    const field = fieldDef as ZodTypeAny;
    const prop = zodFieldToJson(field);
    properties[key] = prop;

    if (!field.isOptional()) {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = {
    type: "object",
    properties,
  };
  if (required.length > 0) {
    result.required = required;
  }
  return result;
}

function zodFieldToJson(field: ZodTypeAny): Record<string, unknown> {
  const def = field._def;

  // Unwrap optional
  if (def.typeName === "ZodOptional") {
    return zodFieldToJson(def.innerType);
  }

  // Unwrap default
  if (def.typeName === "ZodDefault") {
    return zodFieldToJson(def.innerType);
  }

  const result: Record<string, unknown> = {};

  // Extract description
  if (def.description) {
    result.description = def.description;
  }

  switch (def.typeName) {
    case "ZodString":
      result.type = "string";
      break;
    case "ZodNumber":
      result.type = "number";
      break;
    case "ZodBoolean":
      result.type = "boolean";
      break;
    case "ZodEnum":
      result.type = "string";
      result.enum = def.values;
      break;
    default:
      result.type = "string";
  }

  return result;
}
