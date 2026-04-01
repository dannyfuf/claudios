import { getSessionMessageFragmentCount } from "#sdk/session-history"
import { extractToolResultIds, normalizeFileToolResult, normalizeTodoToolResult } from "#sdk/tool-result"
import { MessageUUID } from "#sdk/types"
import {
  conversationReducer,
  initialConversationState,
  type ConversationState,
  type DisplayMessage,
  type ToolCallDisplayMessage,
} from "#state/types"
import { extractAssistantBlocks, extractTextContent } from "#state/conversation-transcript"

type MessageScope = {
  readonly taskId: string | null
  readonly parentToolUseId: string | null
}

export function projectSessionHistory(history: readonly unknown[]): ConversationState {
  let state = initialConversationState

  for (const message of history) {
    state = projectSessionMessage(state, message)
  }

  return state
}

export function projectSessionMessage(
  state: ConversationState,
  message: unknown,
): ConversationState {
  if (!isRecord(message)) {
    return state
  }

  const type = message["type"]
  const messageUuid = typeof message["uuid"] === "string" ? message["uuid"] : crypto.randomUUID()
  const timestamp = new Date()
  const scope: MessageScope = {
    taskId: null,
    parentToolUseId: normalizeOptionalString(message["parent_tool_use_id"]),
  }

  if (type === "user") {
    let nextState = projectHistoryToolResultMessage(state, message)
    const text = extractTextContent(message["message"])
    if (text.length === 0) {
      return nextState
    }

    nextState = conversationReducer(nextState, {
      type: "append_message",
      message: {
        kind: "user",
        uuid: MessageUUID(messageUuid),
        text,
        timestamp,
      },
    })

    return nextState
  }

  if (type !== "assistant") {
    return state
  }

  let nextState = state
  const fragmentCount = getSessionMessageFragmentCount(message)
  const blocks = extractAssistantBlocks(messageUuid, message["message"], {
    defaultToolStatus: "completed",
  })
  const shouldSkipThinkingBlocks =
    fragmentCount > 1 && blocks.some((block) => block.kind === "assistant" || block.kind === "tool_call")

  for (const block of blocks) {
    if (shouldSkipThinkingBlocks && block.kind === "thinking") {
      continue
    }

    switch (block.kind) {
      case "assistant":
        nextState = conversationReducer(nextState, {
          type: "append_message",
          message: {
            kind: "assistant",
            uuid: block.uuid,
            text: block.text,
            isStreaming: false,
            timestamp,
            taskId: scope.taskId,
            parentToolUseId: scope.parentToolUseId,
          },
        })
        break
      case "thinking":
        nextState = conversationReducer(nextState, {
          type: "append_message",
          message: {
            kind: "thinking",
            uuid: block.uuid,
            text: block.text,
            isStreaming: false,
            timestamp,
            taskId: scope.taskId,
            parentToolUseId: scope.parentToolUseId,
          },
        })
        break
      case "tool_call":
        nextState = conversationReducer(nextState, {
          type: "upsert_tool_call_message",
          toolCall: block.toolCall,
          timestamp,
          taskId: scope.taskId,
          parentToolUseId: scope.parentToolUseId,
        })
        break
    }
  }

  return nextState
}

export function projectHistoryToolResultMessage(
  state: ConversationState,
  message: Record<string, unknown>,
): ConversationState {
  const toolResultIds = extractToolResultIds(message["message"])
  if (toolResultIds.length === 0) {
    return state
  }

  let nextState = state

  for (const [index, toolUseId] of toolResultIds.entries()) {
    const toolCallMessage = findToolCallMessage(nextState.messages, toolUseId)
    if (!toolCallMessage) {
      continue
    }

    const toolUseResult = pickIndexedToolUseResult(message["tool_use_result"], index)

    const fileChange = normalizeFileToolResult(toolCallMessage.toolCall.name, toolUseResult)
    if (fileChange) {
      nextState = conversationReducer(nextState, {
        type: "upsert_tool_call_message",
        toolCall: {
          ...toolCallMessage.toolCall,
          status: "completed",
          fileChange,
        },
        timestamp: toolCallMessage.timestamp,
        taskId: toolCallMessage.taskId,
        parentToolUseId: toolCallMessage.parentToolUseId,
      })
    }

    const todoTracker = normalizeTodoToolResult(
      toolCallMessage.toolCall.name,
      toolUseId,
      toolUseResult,
    )
    if (todoTracker) {
      nextState = conversationReducer(nextState, {
        type: "update_todo_tracker",
        tracker: todoTracker,
      })
    }
  }

  return nextState
}

export function pickIndexedToolUseResult(toolUseResult: unknown, index: number): unknown {
  if (!Array.isArray(toolUseResult)) {
    return toolUseResult
  }

  if (toolUseResult.length === 1) {
    return toolUseResult[0]
  }

  return toolUseResult[index]
}

function findToolCallMessage(
  messages: readonly DisplayMessage[],
  toolCallId: string,
): ToolCallDisplayMessage | null {
  for (const message of messages) {
    if (message.kind === "tool_call" && message.toolCall.id === toolCallId) {
      return message
    }
  }

  return null
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
