import type { TodoItem, TodoStatus, TodoTrackerState } from "#sdk/types"

const TODO_WRITE_TOOL_NAMES = new Set(["todowrite"])

export function isTodoWriteToolName(toolName: string): boolean {
  return TODO_WRITE_TOOL_NAMES.has(toolName.trim().toLowerCase())
}

export function normalizeTodoToolResult(
  toolName: string,
  toolUseId: string,
  toolUseResult: unknown,
): TodoTrackerState | null {
  if (!isTodoWriteToolName(toolName) || !isRecord(toolUseResult)) {
    return null
  }

  const newTodos = parseTodoItems(toolUseResult["newTodos"])
  if (!newTodos) {
    return null
  }

  return {
    items: newTodos,
    lastUpdatedAt: new Date(),
    lastSourceToolUseId: toolUseId,
  }
}

function parseTodoItems(value: unknown): readonly TodoItem[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const items: TodoItem[] = []

  for (const item of value) {
    if (!isRecord(item)) {
      return null
    }

    const content = normalizeNonEmptyString(item["content"])
    const status = normalizeTodoStatus(item["status"])

    if (!content || !status) {
      return null
    }

    const activeForm = normalizeNonEmptyString(item["activeForm"])
    if (activeForm) {
      items.push({ content, status, activeForm })
    } else {
      items.push({ content, status })
    }
  }

  return items
}

function normalizeTodoStatus(value: unknown): TodoStatus | null {
  if (value === "pending" || value === "in_progress" || value === "completed") {
    return value
  }

  return null
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
