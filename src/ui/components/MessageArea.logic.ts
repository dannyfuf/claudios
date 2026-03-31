import type { ToolCallStatus, SpawnedTask, SpawnedTaskStatus, SpawnedTaskUsage } from "#sdk/types"
import type { DisplayMessage } from "#state/types"

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

type VisibleToolCalls<TToolCall> = {
  readonly visibleToolCalls: readonly TToolCall[]
  readonly hiddenCount: number
  readonly hasOverflow: boolean
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

export function getVisibleToolCalls<TToolCall>(
  toolCalls: readonly TToolCall[],
  expanded: boolean,
  maxVisible: number,
): VisibleToolCalls<TToolCall> {
  const safeMaxVisible = Math.max(1, maxVisible)
  const hasOverflow = toolCalls.length > safeMaxVisible

  if (!hasOverflow || expanded) {
    return {
      visibleToolCalls: toolCalls,
      hiddenCount: 0,
      hasOverflow,
    }
  }

  const visibleToolCalls = toolCalls.slice(-safeMaxVisible)

  return {
    visibleToolCalls,
    hiddenCount: toolCalls.length - visibleToolCalls.length,
    hasOverflow,
  }
}

export function normalizeToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim()
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

function toPreviewLine(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim()

  if (singleLine.length <= TOOL_PREVIEW_MAX_LENGTH) {
    return singleLine
  }

  return `${singleLine.slice(0, TOOL_PREVIEW_MAX_LENGTH - 3)}...`
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
