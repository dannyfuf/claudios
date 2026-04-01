import type {
  MessageUUID,
  SDKMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  ToolCall,
} from "#sdk/types"
import { SessionId } from "#sdk/types"
import { isPermissionModeName } from "#shared/permission-modes"
import { extractToolResultIds, normalizeFileToolResult, normalizeTodoToolResult } from "#sdk/tool-result"
import { pickIndexedToolUseResult } from "#state/conversation-history"
import {
  appendStreamingTranscriptDelta,
  finalizeStreamingBlocksForMessage,
  resolveTranscriptBlockUuid,
  startStreamingTranscriptBlock,
  stopStreamingTranscriptBlock,
  type MessageScope,
  type SDKMessageContext,
  type StreamingBlockKind,
  type TranscriptTextMessage,
  type TranscriptTextMessageInput,
} from "#state/conversation-streaming"
import { extractAssistantBlocks } from "#state/conversation-transcript"
import type { ConversationAction, ToolCallDisplayMessage } from "#state/types"

type FinalizedToolCallStatus = Exclude<ToolCall["status"], "running">

export type SDKMessageHandlerDependencies = {
  readonly appendErrorMessage: (text: string, recoverable?: boolean) => void
  readonly appendSystemMessage: (text: string) => void
  readonly dispatch: (action: ConversationAction) => void
  readonly finalizeAllRunningToolCalls: (status: FinalizedToolCallStatus) => void
  readonly finalizeRunningToolCallsForScope: (
    scope: MessageScope,
    status: FinalizedToolCallStatus,
  ) => void
  readonly getLatestReusableTranscriptTextMessage: (
    kind: StreamingBlockKind,
    scope: MessageScope,
  ) => TranscriptTextMessage | null
  readonly getToolCallMessage: (toolCallId: string) => ToolCallDisplayMessage | null
  readonly getTranscriptTextMessage: (uuid: MessageUUID) => TranscriptTextMessage | null
  readonly handleTaskNotificationMessage: (message: SDKTaskNotificationMessage) => void
  readonly handleTaskProgressMessage: (message: SDKTaskProgressMessage) => void
  readonly handleTaskStartedMessage: (message: SDKTaskStartedMessage) => void
  readonly resolveMessageScope: (parentToolUseId: string | null, taskId?: string | null) => MessageScope
  readonly setMessageStreaming: (uuid: MessageUUID, isStreaming: boolean) => void
  readonly updateToolCallById: (
    toolCallId: string,
    updater: (toolCall: ToolCall) => ToolCall,
  ) => void
  readonly upsertToolCallMessage: (toolCall: ToolCall, scope: MessageScope, timestamp: Date) => void
  readonly upsertTranscriptTextMessage: (options: TranscriptTextMessageInput) => void
}

export function handleSDKMessage(
  message: SDKMessage,
  ctx: SDKMessageContext,
  dependencies: SDKMessageHandlerDependencies,
): void {
  switch (message.type) {
    case "assistant": {
      handleAssistantMessage(message, ctx, dependencies)
      break
    }

    case "user": {
      handleUserMessage(message, dependencies)
      break
    }

    case "stream_event": {
      handleStreamEventMessage(message, ctx, dependencies)
      break
    }

    case "result": {
      if (message.subtype === "success") {
        dependencies.dispatch({
          type: "update_cost",
          costUsd: message.total_cost_usd,
          tokens: message.usage.input_tokens + message.usage.output_tokens,
        })
        dependencies.finalizeAllRunningToolCalls("completed")
        if (message.session_id) {
          dependencies.dispatch({
            type: "set_session",
            sessionId: SessionId(message.session_id),
          })
        }
      } else {
        dependencies.finalizeAllRunningToolCalls("error")
        dependencies.appendErrorMessage(
          message.errors.length > 0 ? message.errors.join("\n") : "Query failed",
        )
      }
      dependencies.dispatch({ type: "set_session_state", state: { status: "idle" } })
      break
    }

    case "system": {
      switch (message.subtype) {
        case "init": {
          const initMessage = message as Record<string, unknown>
          if (typeof initMessage["model"] === "string") {
            dependencies.dispatch({ type: "set_model", model: initMessage["model"] })
          }
          if (
            typeof initMessage["permissionMode"] === "string"
            && isPermissionModeName(initMessage["permissionMode"])
          ) {
            dependencies.dispatch({
              type: "set_permission_mode",
              mode: initMessage["permissionMode"],
            })
          }
          if (typeof initMessage["session_id"] === "string") {
            dependencies.dispatch({
              type: "set_session",
              sessionId: SessionId(initMessage["session_id"]),
            })
          }
          break
        }

        case "local_command_output": {
          dependencies.appendSystemMessage(message.content)
          break
        }

        case "task_started": {
          dependencies.handleTaskStartedMessage(message)
          break
        }

        case "task_progress": {
          dependencies.handleTaskProgressMessage(message)
          break
        }

        case "task_notification": {
          dependencies.handleTaskNotificationMessage(message)
          break
        }

        case "status": {
          if (message.permissionMode && isPermissionModeName(message.permissionMode)) {
            dependencies.dispatch({
              type: "set_permission_mode",
              mode: message.permissionMode,
            })
          }
          break
        }

        default:
          break
      }
      break
    }

    case "tool_progress": {
      handleToolProgressMessage(message, dependencies)
      break
    }

    case "tool_use_summary": {
      handleToolUseSummaryMessage(message, dependencies)
      break
    }

    default:
      break
  }
}

function handleAssistantMessage(
  message: Extract<SDKMessage, { readonly type: "assistant" }>,
  ctx: SDKMessageContext,
  dependencies: SDKMessageHandlerDependencies,
): void {
  const timestamp = new Date()
  const scope = dependencies.resolveMessageScope(message.parent_tool_use_id)
  const blocks = extractAssistantBlocks(message.uuid, message.message, {
    defaultToolStatus: "running",
  })
  const finalizedRowUuids = new Set<MessageUUID>()
  let hasFinalizedScopeTools = false

  for (const block of blocks) {
    switch (block.kind) {
      case "assistant":
      case "thinking":
        if (!hasFinalizedScopeTools) {
          dependencies.finalizeRunningToolCallsForScope(scope, "completed")
          hasFinalizedScopeTools = true
        }
        const rowUuid = resolveTranscriptBlockUuid(message.uuid, block, ctx, scope)
        dependencies.upsertTranscriptTextMessage({
          kind: block.kind,
          uuid: rowUuid,
          text: block.text,
          isStreaming: false,
          timestamp,
          scope,
        })
        finalizedRowUuids.add(rowUuid)
        break
      case "tool_call":
        dependencies.upsertToolCallMessage(block.toolCall, scope, timestamp)
        break
    }
  }

  finalizeStreamingBlocksForMessage(getStreamingDependencies(dependencies), {
    messageUuid: message.uuid,
    finalizedRowUuids,
    streamingBlocks: ctx.streamingBlocks,
  })
}

function handleUserMessage(
  message: Extract<SDKMessage, { readonly type: "user" }>,
  dependencies: SDKMessageHandlerDependencies,
): void {
  const toolResultIds = extractToolResultIds(message.message)
  if (toolResultIds.length === 0) {
    return
  }

  for (const [index, toolUseId] of toolResultIds.entries()) {
    const toolCallMessage = dependencies.getToolCallMessage(toolUseId)
    if (!toolCallMessage) {
      continue
    }

    const toolUseResult = pickIndexedToolUseResult(message.tool_use_result, index)

    const fileChange = normalizeFileToolResult(toolCallMessage.toolCall.name, toolUseResult)
    if (fileChange) {
      dependencies.updateToolCallById(toolUseId, (toolCall) => ({
        ...toolCall,
        status: "completed",
        fileChange,
      }))
    }

    const todoTracker = normalizeTodoToolResult(
      toolCallMessage.toolCall.name,
      toolUseId,
      toolUseResult,
    )
    if (todoTracker) {
      dependencies.dispatch({ type: "update_todo_tracker", tracker: todoTracker })
    }
  }
}

function handleStreamEventMessage(
  message: Extract<SDKMessage, { readonly type: "stream_event" }>,
  ctx: SDKMessageContext,
  dependencies: SDKMessageHandlerDependencies,
): void {
  const timestamp = new Date()
  const scope = dependencies.resolveMessageScope(message.parent_tool_use_id)

  switch (message.event.type) {
    case "content_block_start": {
      const contentBlock = message.event.content_block

      switch (contentBlock.type) {
        case "text":
          startStreamingTranscriptBlock(getStreamingDependencies(dependencies), {
            messageUuid: message.uuid,
            blockIndex: message.event.index,
            kind: "assistant",
            initialText: contentBlock.text,
            scope,
            timestamp,
            ctx,
          })
          break
        case "thinking":
          startStreamingTranscriptBlock(getStreamingDependencies(dependencies), {
            messageUuid: message.uuid,
            blockIndex: message.event.index,
            kind: "thinking",
            initialText: contentBlock.thinking,
            scope,
            timestamp,
            ctx,
          })
          break
        case "tool_use":
        case "server_tool_use":
          dependencies.upsertToolCallMessage(
            {
              id: contentBlock.id,
              name: contentBlock.name,
              input: isRecord(contentBlock.input) ? contentBlock.input : {},
              status: "running",
              output: null,
              elapsedSeconds: null,
            },
            scope,
            timestamp,
          )
          break
        default:
          break
      }
      break
    }

    case "content_block_delta": {
      switch (message.event.delta.type) {
        case "text_delta":
          appendStreamingTranscriptDelta(getStreamingDependencies(dependencies), {
            messageUuid: message.uuid,
            blockIndex: message.event.index,
            kind: "assistant",
            deltaText: message.event.delta.text,
            scope,
            timestamp,
            ctx,
          })
          break
        case "thinking_delta":
          appendStreamingTranscriptDelta(getStreamingDependencies(dependencies), {
            messageUuid: message.uuid,
            blockIndex: message.event.index,
            kind: "thinking",
            deltaText: message.event.delta.thinking,
            scope,
            timestamp,
            ctx,
          })
          break
        default:
          break
      }
      break
    }

    case "content_block_stop":
      stopStreamingTranscriptBlock(getStreamingDependencies(dependencies), {
        messageUuid: message.uuid,
        blockIndex: message.event.index,
        streamingBlocks: ctx.streamingBlocks,
      })
      break

    default:
      break
  }
}

function handleToolProgressMessage(
  message: Extract<SDKMessage, { readonly type: "tool_progress" }>,
  dependencies: SDKMessageHandlerDependencies,
): void {
  dependencies.upsertToolCallMessage(
    {
      id: message.tool_use_id,
      name: message.tool_name,
      input: {},
      status: "running",
      output: null,
      elapsedSeconds: message.elapsed_time_seconds,
    },
    dependencies.resolveMessageScope(message.parent_tool_use_id, message.task_id ?? null),
    new Date(),
  )
}

function handleToolUseSummaryMessage(
  message: Extract<SDKMessage, { readonly type: "tool_use_summary" }>,
  dependencies: SDKMessageHandlerDependencies,
): void {
  for (const toolUseId of message.preceding_tool_use_ids) {
    dependencies.updateToolCallById(toolUseId, (toolCall) => ({
      ...toolCall,
      status: "completed",
      output: message.summary,
    }))
  }
}

function getStreamingDependencies(dependencies: SDKMessageHandlerDependencies) {
  return {
    finalizeRunningToolCallsForScope: dependencies.finalizeRunningToolCallsForScope,
    getLatestReusableTranscriptTextMessage: dependencies.getLatestReusableTranscriptTextMessage,
    getTranscriptTextMessage: dependencies.getTranscriptTextMessage,
    setMessageStreaming: dependencies.setMessageStreaming,
    upsertTranscriptTextMessage: dependencies.upsertTranscriptTextMessage,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
