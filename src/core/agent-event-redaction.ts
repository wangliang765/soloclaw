import type { JsonObject, ToolDisplay } from "../protocol/types.js";

const API_KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
];

export function redactAgentEventText(value: string): string {
  return API_KEY_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED:api_key]"), value);
}

export function summarizeToolInput(toolName: string, input: JsonObject): ToolDisplay {
  switch (toolName) {
    case "read_file": {
      const filePath = safeString(input.path);
      return { title: `Read ${filePath}`, paths: safePathList(input.path), detailsHidden: true };
    }
    case "search_text": {
      const query = safeString(input.query);
      return { title: `Search ${query}`, detailsHidden: true };
    }
    case "list_files": {
      const filePath = safeString(input.path) || ".";
      return { title: `List ${filePath}`, paths: filePath ? [filePath] : undefined, detailsHidden: true };
    }
    case "run_command":
      return { title: "Run command", detailsHidden: true };
    case "apply_patch":
      return { title: "Apply patch", detailsHidden: true };
    case "create_file": {
      const filePath = safeString(input.path);
      return { title: `Create ${filePath}`, paths: safePathList(input.path), detailsHidden: true };
    }
    case "replace_range": {
      const filePath = safeString(input.path);
      return { title: `Edit ${filePath}`, paths: safePathList(input.path), detailsHidden: true };
    }
    default:
      return { title: toolName, detailsHidden: true };
  }
}

function safeString(value: unknown): string {
  return redactAgentEventText(typeof value === "string" ? value : "");
}

function safePathList(value: unknown): string[] | undefined {
  return typeof value === "string" && value ? [redactAgentEventText(value)] : undefined;
}
