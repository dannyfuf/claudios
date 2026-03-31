import type {
  ToolCall,
  ToolCallStatus,
  ToolCallFileChange,
  SpawnedTask,
  SpawnedTaskStatus,
  SpawnedTaskUsage,
  TodoItem,
} from "#sdk/types"
import type { DisplayMessage, ThinkingDisplayMessage } from "#state/types"

export type StatusTone = "warning" | "success" | "error" | "primary"

export type MessageLayout = {
  readonly compact: boolean
  readonly horizontalPadding: number
  readonly columnWidth: number
  readonly userBubbleWidth: number
  readonly sectionPaddingY: number
  readonly metaGapBottom: number
}

export type ToolStatusPresentation =
  | { readonly kind: "spinner"; readonly tone: "warning" }
  | { readonly kind: "icon"; readonly icon: "✓" | "✗"; readonly tone: "success" | "error" }

export type TaskStatusPresentation =
  | { readonly kind: "spinner"; readonly tone: "warning" }
  | {
      readonly kind: "icon"
      readonly icon: "✓" | "✗" | "■"
      readonly tone: "success" | "error" | "primary"
    }

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

export function getMessageLayout(width: number): MessageLayout {
  const compact = width < 92
  const horizontalPadding = compact ? 1 : width < 124 ? 2 : 4
  const availableWidth = Math.max(28, width - horizontalPadding * 2)
  const columnWidth = compact ? availableWidth : Math.min(availableWidth, width >= 132 ? 104 : 92)
  const userBubbleWidth = compact
    ? Math.max(28, Math.min(columnWidth, availableWidth - 2))
    : Math.max(34, Math.min(columnWidth, Math.floor(columnWidth * 0.78)))

  return {
    compact,
    horizontalPadding,
    columnWidth,
    userBubbleWidth,
    sectionPaddingY: compact ? 0 : 1,
    metaGapBottom: compact ? 0 : 1,
  }
}

export function shouldShowAssistantResponseDivider(
  messages: readonly DisplayMessage[],
  index: number,
): boolean {
  const message = messages[index]
  if (!message || message.kind !== "assistant") {
    return false
  }

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previousMessage = messages[cursor]
    if (!previousMessage) {
      continue
    }

    if (previousMessage.kind === "user") {
      return true
    }

    if (previousMessage.kind === "assistant") {
      return false
    }
  }

  return false
}

export function mergeConsecutiveThinkingMessages(
  messages: readonly DisplayMessage[],
): DisplayMessage[] {
  const merged: DisplayMessage[] = []

  for (const message of messages) {
    const previousMessage = merged.at(-1)

    if (
      message.kind !== "thinking" ||
      previousMessage?.kind !== "thinking" ||
      previousMessage.parentToolUseId !== message.parentToolUseId ||
      previousMessage.taskId !== message.taskId
    ) {
      merged.push(message)
      continue
    }

    merged[merged.length - 1] = {
      ...previousMessage,
      text: joinThinkingText(previousMessage.text, message.text),
      isStreaming: message.isStreaming,
      timestamp: message.timestamp,
      taskId: previousMessage.taskId === message.taskId ? previousMessage.taskId : null,
      parentToolUseId:
        previousMessage.parentToolUseId === message.parentToolUseId
          ? previousMessage.parentToolUseId
          : null,
    } satisfies ThinkingDisplayMessage
  }

  return merged
}

export function normalizeToolLabel(value: string): string {
  const withoutComplete = value.replace(/\s+(?:complete|completed)\s*$/i, "").trim()

  // Humanize MCP tool names: mcp__morph__edit_file -> morph: edit file
  const mcpMatch = /^mcp__([^_][^_]*)__(.+)$/.exec(withoutComplete)
  if (mcpMatch) {
    const server = mcpMatch[1]!
    const tool = mcpMatch[2]!.replace(/_/g, " ")
    return `${server}: ${tool}`
  }

  // Humanize TodoWrite
  if (withoutComplete.toLowerCase() === "todowrite") {
    return "tasks"
  }

  return withoutComplete
}

export function getTodoProgress(items: readonly TodoItem[]): {
  readonly currentIndex: number
  readonly total: number
  readonly completedCount: number
  readonly activeItem: TodoItem | null
} {
  const total = items.length
  const completedCount = items.filter((i) => i.status === "completed").length
  const activeItem =
    items.find((i) => i.status === "in_progress") ??
    items.find((i) => i.status === "pending") ??
    null
  const currentIndex = activeItem ? items.indexOf(activeItem) : total
  return { currentIndex, total, completedCount, activeItem }
}

export function formatTodoSummaryLine(items: readonly TodoItem[], maxLength = 50): string {
  if (items.length === 0) {
    return ""
  }

  const { completedCount, total, activeItem } = getTodoProgress(items)

  if (completedCount === total) {
    return `tasks ${completedCount}/${total} done`
  }

  const current = completedCount + 1
  const prefix = `${current}/${total}`

  if (!activeItem) {
    return `${prefix} tasks`
  }

  const detail = activeItem.activeForm ?? activeItem.content
  const line = `${prefix} ${detail}`
  const singleLine = line.replace(/\s+/g, " ").trim()
  if (singleLine.length <= maxLength) {
    return singleLine
  }
  return `${singleLine.slice(0, maxLength - 1)}…`
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

export function getTaskStatusPresentation(status: SpawnedTaskStatus): TaskStatusPresentation {
  switch (status) {
    case "running":
      return { kind: "spinner", tone: "warning" }
    case "completed":
      return { kind: "icon", icon: "✓", tone: "success" }
    case "failed":
      return { kind: "icon", icon: "✗", tone: "error" }
    case "stopped":
      return { kind: "icon", icon: "■", tone: "primary" }
  }

  return assertNever(status)
}

export function getToolBriefDetail(toolCall: {
  readonly input?: Record<string, unknown>
  readonly output?: string | null
}): string {
  const input = toolCall.input

  if (input) {
    // Special case: TodoWrite uses a `todos` array — show the task summary
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function getToolCallDiffFileChange(
  toolCall: Pick<ToolCall, "status" | "fileChange">,
): ToolCallFileChange | null {
  if (toolCall.status !== "completed") {
    return null
  }

  return toolCall.fileChange ?? null
}

export function formatTaskKindLabel(task: Pick<SpawnedTask, "taskType" | "workflowName">): string {
  const workflowName = normalizeOptionalText(task.workflowName)
  if (workflowName) {
    return `workflow ${humanizeTaskLabel(workflowName)}`
  }

  const taskType = normalizeOptionalText(task.taskType)
  if (!taskType) {
    return "task"
  }

  switch (taskType) {
    case "local_agent":
      return "subagent"
    case "local_workflow":
      return "workflow"
    default:
      return humanizeTaskLabel(taskType)
  }
}

export function formatTaskUsage(usage: SpawnedTaskUsage | null): string {
  if (!usage) {
    return ""
  }

  const toolLabel = `${usage.toolUses} tool${usage.toolUses === 1 ? "" : "s"}`
  const tokenLabel = `${usage.totalTokens} token${usage.totalTokens === 1 ? "" : "s"}`

  return `${formatDurationMs(usage.durationMs)}, ${toolLabel}, ${tokenLabel}`
}

export function getTaskDetailLine(
  task: Pick<SpawnedTask, "summary" | "lastToolName">,
): string {
  const summary = normalizeOptionalText(task.summary)
  if (summary) {
    return toPreviewLine(summary)
  }

  const lastToolName = normalizeOptionalText(task.lastToolName)
  if (lastToolName) {
    return `using ${normalizeToolLabel(lastToolName)}`
  }

  return ""
}

export function getTaskContextLabel(
  task: Pick<SpawnedTask, "description" | "taskType" | "workflowName">,
): string {
  return `${formatTaskKindLabel(task)}: ${toPreviewLine(task.description)}`
}

function toPreviewLine(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim()

  if (singleLine.length <= TOOL_PREVIEW_MAX_LENGTH) {
    return singleLine
  }

  return `${singleLine.slice(0, TOOL_PREVIEW_MAX_LENGTH - 3)}...`
}

function joinThinkingText(current: string, next: string): string {
  if (current.length === 0) {
    return next
  }

  if (next.length === 0) {
    return current
  }

  return `${current}\n${next}`
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }

  if (durationMs < 60_000) {
    const seconds = durationMs / 1000
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  }

  const wholeSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(wholeSeconds / 60)
  const seconds = wholeSeconds % 60
  return `${minutes}m ${seconds}s`
}

function humanizeTaskLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").trim()
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function assertNever(value: never): never {
  throw new Error(`Unhandled tool status: ${String(value)}`)
}
