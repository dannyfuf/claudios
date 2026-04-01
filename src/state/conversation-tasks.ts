import type {
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SpawnedTask,
} from "#sdk/types"

export function mergeTaskStarted(
  current: SpawnedTask | null,
  message: SDKTaskStartedMessage,
): SpawnedTask {
  const hasFinalStatus = current !== null && isFinalTaskStatus(current.status)

  return {
    id: message.task_id,
    description: normalizeTaskDescription(message.description, current),
    taskType: normalizeOptionalTaskText(message.task_type) ?? current?.taskType ?? null,
    workflowName: normalizeOptionalTaskText(message.workflow_name) ?? current?.workflowName ?? null,
    toolUseId: normalizeOptionalTaskText(message.tool_use_id) ?? current?.toolUseId ?? null,
    prompt: normalizeOptionalTaskText(message.prompt) ?? current?.prompt ?? null,
    status: hasFinalStatus ? current.status : "running",
    summary: current?.summary ?? null,
    lastToolName: current?.lastToolName ?? null,
    outputFile: current?.outputFile ?? null,
    usage: current?.usage ?? null,
  }
}

export function mergeTaskProgress(
  current: SpawnedTask | null,
  message: SDKTaskProgressMessage,
): SpawnedTask {
  const hasFinalStatus = current !== null && isFinalTaskStatus(current.status)
  const nextSummary = normalizeOptionalTaskText(message.summary)
  const nextLastToolName = normalizeOptionalTaskText(message.last_tool_name)
  const nextUsage = taskUsageFromSDK(message.usage)

  return {
    id: message.task_id,
    description: normalizeTaskDescription(message.description, current),
    taskType: current?.taskType ?? null,
    workflowName: current?.workflowName ?? null,
    toolUseId: normalizeOptionalTaskText(message.tool_use_id) ?? current?.toolUseId ?? null,
    prompt: current?.prompt ?? null,
    status: hasFinalStatus ? current.status : "running",
    summary: hasFinalStatus ? current?.summary ?? nextSummary ?? null : nextSummary ?? current?.summary ?? null,
    lastToolName: hasFinalStatus
      ? current?.lastToolName ?? nextLastToolName ?? null
      : nextLastToolName ?? current?.lastToolName ?? null,
    outputFile: current?.outputFile ?? null,
    usage: hasFinalStatus ? current?.usage ?? nextUsage ?? null : nextUsage,
  }
}

export function mergeTaskNotification(
  current: SpawnedTask | null,
  message: SDKTaskNotificationMessage,
): SpawnedTask {
  return {
    id: message.task_id,
    description: current?.description ?? "Background task",
    taskType: current?.taskType ?? null,
    workflowName: current?.workflowName ?? null,
    toolUseId: normalizeOptionalTaskText(message.tool_use_id) ?? current?.toolUseId ?? null,
    prompt: current?.prompt ?? null,
    status: message.status,
    summary: normalizeOptionalTaskText(message.summary) ?? current?.summary ?? null,
    lastToolName: current?.lastToolName ?? null,
    outputFile: normalizeOptionalTaskText(message.output_file) ?? current?.outputFile ?? null,
    usage: taskUsageFromSDK(message.usage) ?? current?.usage ?? null,
  }
}

export function taskUsageFromSDK(
  usage: SDKTaskProgressMessage["usage"] | SDKTaskNotificationMessage["usage"] | undefined,
): SpawnedTask["usage"] {
  if (!usage) {
    return null
  }

  return {
    totalTokens: usage.total_tokens,
    toolUses: usage.tool_uses,
    durationMs: usage.duration_ms,
  }
}

export function isFinalTaskStatus(status: SpawnedTask["status"]): boolean {
  return status === "completed" || status === "failed" || status === "stopped"
}

function normalizeTaskDescription(description: string, current: SpawnedTask | null): string {
  return normalizeOptionalTaskText(description) ?? current?.description ?? "Background task"
}

function normalizeOptionalTaskText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}
