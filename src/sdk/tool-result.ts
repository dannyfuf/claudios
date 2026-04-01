export { buildUnifiedPatchFromStructuredPatch } from "./tool-result/patch"
export { isFileModifyingToolName, normalizeFileToolResult } from "./tool-result/file-change"
export { isTodoWriteToolName, normalizeTodoToolResult } from "./tool-result/todo"

export function extractToolResultIds(message: unknown): readonly string[] {
  if (!isRecord(message)) {
    return []
  }

  const content = message["content"]
  if (!Array.isArray(content)) {
    return []
  }

  const toolUseIds: string[] = []
  const seen = new Set<string>()

  for (const block of content) {
    if (!isRecord(block) || block["type"] !== "tool_result") {
      continue
    }

    const toolUseId = block["tool_use_id"]
    if (typeof toolUseId !== "string" || seen.has(toolUseId)) {
      continue
    }

    seen.add(toolUseId)
    toolUseIds.push(toolUseId)
  }

  return toolUseIds
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
