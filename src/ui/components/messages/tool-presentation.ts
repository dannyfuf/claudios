import type {
  TodoItem,
  ToolCall,
  ToolCallFileChange,
  ToolCallStatus,
} from "#sdk/types"
import { formatTodoSummaryLine } from "#ui/components/messages/task-presentation"

export type ToolStatusPresentation =
  | { readonly kind: "spinner"; readonly tone: "warning" }
  | { readonly kind: "icon"; readonly icon: "✓" | "✗"; readonly tone: "success" | "error" }

const TOOL_PREVIEW_KEYS = [
  "file_path",
  "filePath",
  "path",
  "command",
  "pattern",
  "query",
  "url",
  "description",
  "content",
] as const

const TOOL_PREVIEW_MAX_LENGTH = 60

export function normalizeToolLabel(value: string): string {
  const withoutComplete = value.replace(/\s+(?:complete|completed)\s*$/i, "").trim()

  const mcpMatch = /^mcp__([^_][^_]*)__(.+)$/.exec(withoutComplete)
  if (mcpMatch) {
    const server = mcpMatch[1]!
    const tool = mcpMatch[2]!.replace(/_/g, " ")
    return `${server}: ${tool}`
  }

  if (withoutComplete.toLowerCase() === "todowrite") {
    return "tasks"
  }

  return withoutComplete
}

export function getToolStatusPresentation(status: ToolCallStatus): ToolStatusPresentation {
  switch (status) {
    case "running":
      return { kind: "spinner", tone: "warning" }
    case "completed":
      return { kind: "icon", icon: "✓", tone: "success" }
    case "error":
      return { kind: "icon", icon: "✗", tone: "error" }
  }

  return assertNever(status)
}

export function getToolBriefDetail(toolCall: {
  readonly input?: Record<string, unknown>
  readonly output?: string | null
}): string {
  const input = toolCall.input

  if (input) {
    const todosArray = input["todos"]
    if (Array.isArray(todosArray) && todosArray.length > 0) {
      const items = parseTodoItemsForPreview(todosArray)
      if (items.length > 0) {
        return formatTodoSummaryLine(items)
      }
    }

    for (const key of TOOL_PREVIEW_KEYS) {
      const value = input[key]
      if (typeof value === "string" && value.trim().length > 0) {
        return toPreviewLine(value)
      }
    }
  }

  if (typeof toolCall.output === "string" && toolCall.output.trim().length > 0) {
    return toPreviewLine(toolCall.output)
  }

  return ""
}

export function getToolCallDiffFileChange(
  toolCall: Pick<ToolCall, "status" | "fileChange">,
): ToolCallFileChange | null {
  if (toolCall.status !== "completed") {
    return null
  }

  return toolCall.fileChange ?? null
}

function parseTodoItemsForPreview(todos: readonly unknown[]): TodoItem[] {
  const items: TodoItem[] = []

  for (const item of todos) {
    if (!isRecord(item)) {
      continue
    }

    const content = typeof item["content"] === "string" ? item["content"].trim() : ""
    const status = item["status"]
    if (!content || (status !== "pending" && status !== "in_progress" && status !== "completed")) {
      continue
    }

    const activeFormRaw = item["activeForm"]
    const activeForm =
      typeof activeFormRaw === "string" && activeFormRaw.trim().length > 0
        ? activeFormRaw.trim()
        : undefined

    if (activeForm) {
      items.push({ content, status, activeForm })
    } else {
      items.push({ content, status })
    }
  }

  return items
}

function toPreviewLine(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim()

  if (singleLine.length <= TOOL_PREVIEW_MAX_LENGTH) {
    return singleLine
  }

  return `${singleLine.slice(0, TOOL_PREVIEW_MAX_LENGTH - 3)}...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`)
}
