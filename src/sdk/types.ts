/**
 * Domain types wrapping the Claude Agent SDK types.
 *
 * We re-export SDK types we depend on and define our own domain-specific
 * wrappers so the rest of the codebase never imports from the SDK directly.
 */

import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKSystemMessage,
  SDKPartialAssistantMessage,
  SDKStatusMessage,
  SDKToolProgressMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKSessionStateChangedMessage,
  SDKSessionInfo,
  Query,
  Options,
  CanUseTool,
  SlashCommand,
  ModelInfo,
  AccountInfo,
  PermissionMode,
  McpServerStatus,
} from "@anthropic-ai/claude-agent-sdk"

// ---------------------------------------------------------------------------
// Re-exports (so other modules import from here, not from the SDK)
// ---------------------------------------------------------------------------

export type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKSystemMessage,
  SDKPartialAssistantMessage,
  SDKStatusMessage,
  SDKToolProgressMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKSessionStateChangedMessage,
  SDKSessionInfo,
  Query,
  Options,
  CanUseTool,
  SlashCommand,
  ModelInfo,
  AccountInfo,
  PermissionMode,
  McpServerStatus,
}

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

export type SessionId = string & { readonly __brand: "SessionId" }
export type MessageUUID = string & { readonly __brand: "MessageUUID" }

export function SessionId(raw: string): SessionId {
  return raw as SessionId
}

export function MessageUUID(raw: string): MessageUUID {
  return raw as MessageUUID
}

// ---------------------------------------------------------------------------
// Tool use representation
// ---------------------------------------------------------------------------

export type ToolCallStatus = "running" | "completed" | "error"

export type ToolCallFileChangeType = "added" | "modified"

export type ToolCallFileChange = {
  readonly filePath: string
  readonly patch: string
  readonly changeType: ToolCallFileChangeType
}

export type ToolCall = {
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
  readonly status: ToolCallStatus
  readonly output: string | null
  readonly elapsedSeconds: number | null
  readonly fileChange?: ToolCallFileChange
}

// ---------------------------------------------------------------------------
// Spawned task representation
// ---------------------------------------------------------------------------

export type SpawnedTaskStatus = "running" | "completed" | "failed" | "stopped"

export type SpawnedTaskUsage = {
  readonly totalTokens: number
  readonly toolUses: number
  readonly durationMs: number
}

export type SpawnedTask = {
  readonly id: string
  readonly description: string
  readonly taskType: string | null
  readonly workflowName: string | null
  readonly toolUseId: string | null
  readonly prompt: string | null
  readonly status: SpawnedTaskStatus
  readonly summary: string | null
  readonly lastToolName: string | null
  readonly outputFile: string | null
  readonly usage: SpawnedTaskUsage | null
}

// ---------------------------------------------------------------------------
// Permission prompt
// ---------------------------------------------------------------------------

export type PermissionRequest = {
  readonly toolName: string
  readonly toolInput: Record<string, unknown>
  readonly resolve: (allowed: boolean) => void
}

// ---------------------------------------------------------------------------
// Session summary (domain-friendly projection of SDKSessionInfo)
// ---------------------------------------------------------------------------

export type SessionSummary = {
  readonly id: SessionId
  readonly title: string
  readonly lastModified: Date
  readonly messageCount: number | null
  readonly gitBranch: string | null
  readonly cwd: string | null
}

export function sessionSummaryFromSDK(info: SDKSessionInfo): SessionSummary {
  return {
    id: SessionId(info.sessionId),
    title: info.customTitle ?? info.summary ?? info.firstPrompt ?? "(untitled)",
    lastModified: new Date(info.lastModified),
    messageCount: null, // SDK doesn't provide this directly
    gitBranch: info.gitBranch ?? null,
    cwd: info.cwd ?? null,
  }
}
