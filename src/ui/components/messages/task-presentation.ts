import type {
  SpawnedTask,
  SpawnedTaskStatus,
  SpawnedTaskUsage,
  TodoItem,
} from "#sdk/types"

export type TaskStatusPresentation =
  | { readonly kind: "spinner"; readonly tone: "warning" }
  | {
      readonly kind: "icon"
      readonly icon: "✓" | "✗" | "■"
      readonly tone: "success" | "error" | "primary"
    }

export function getTodoProgress(items: readonly TodoItem[]): {
  readonly currentIndex: number
  readonly total: number
  readonly completedCount: number
  readonly activeItem: TodoItem | null
} {
  const total = items.length
  const completedCount = items.filter((item) => item.status === "completed").length
  const activeItem =
    items.find((item) => item.status === "in_progress") ??
    items.find((item) => item.status === "pending") ??
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
    return `using ${lastToolName.replace(/\s+(?:complete|completed)\s*$/i, "").trim()}`
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

  if (singleLine.length <= 60) {
    return singleLine
  }

  return `${singleLine.slice(0, 57)}...`
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
  throw new Error(`Unhandled value: ${String(value)}`)
}
