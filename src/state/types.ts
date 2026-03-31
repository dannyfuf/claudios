/**
 * Core state types for the TUI application.
 *
 * ConversationState is the central discriminated union that drives the UI.
 * VimMode controls the input editing mode.
 */

import { MessageUUID } from "#sdk/types"
import type {
  SessionId,
  ToolCall,
  SpawnedTask,
  PermissionRequest,
  ModelInfo,
  AccountInfo,
  SlashCommand,
  TodoTrackerState,
} from "#sdk/types"
import { DEFAULT_THEME_NAME, type ThemeName } from "#ui/theme"

// ---------------------------------------------------------------------------
// Vim mode
// ---------------------------------------------------------------------------

export type VimMode = "insert" | "normal"

export type InteractionMode = "plain" | VimMode

// ---------------------------------------------------------------------------
// Display message types (what the UI renders)
// ---------------------------------------------------------------------------

export type DisplayMessage =
  | UserDisplayMessage
  | AssistantDisplayMessage
  | ThinkingDisplayMessage
  | ToolCallDisplayMessage
  | SystemDisplayMessage
  | TaskDisplayMessage
  | ErrorDisplayMessage

type MessageScope = {
  readonly taskId: string | null
  readonly parentToolUseId: string | null
}

export type UserDisplayMessage = {
  readonly kind: "user"
  readonly uuid: MessageUUID
  readonly text: string
  readonly timestamp: Date
}

export type AssistantDisplayMessage = MessageScope & {
  readonly kind: "assistant"
  readonly uuid: MessageUUID
  readonly text: string
  readonly isStreaming: boolean
  readonly timestamp: Date
}

export type ThinkingDisplayMessage = MessageScope & {
  readonly kind: "thinking"
  readonly uuid: MessageUUID
  readonly text: string
  readonly isStreaming: boolean
  readonly timestamp: Date
}

export type ToolCallDisplayMessage = MessageScope & {
  readonly kind: "tool_call"
  readonly uuid: MessageUUID
  readonly toolCall: ToolCall
  readonly timestamp: Date
}

export type SystemDisplayMessage = {
  readonly kind: "system"
  readonly uuid: MessageUUID
  readonly text: string
  readonly timestamp: Date
}

export type TaskDisplayMessage = {
  readonly kind: "task"
  readonly uuid: MessageUUID
  readonly task: SpawnedTask
  readonly timestamp: Date
}

export type ErrorDisplayMessage = {
  readonly kind: "error"
  readonly uuid: MessageUUID
  readonly text: string
  readonly recoverable: boolean
  readonly timestamp: Date
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export type SessionState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "awaiting_permission"; readonly request: PermissionRequest }
  | { readonly status: "error"; readonly message: string }

export type StartupTaskState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "failed"; readonly message: string }

export type StartupState = {
  readonly auth: StartupTaskState
  readonly resume: StartupTaskState
  readonly metadata: StartupTaskState
}

// ---------------------------------------------------------------------------
// Conversation state (the central Ref)
// ---------------------------------------------------------------------------

export type ConversationState = {
  readonly sessionId: SessionId | null
  readonly sessionState: SessionState
  readonly startup: StartupState
  readonly messages: readonly DisplayMessage[]
  readonly promptText: string
  readonly model: string
  readonly permissionMode: string
  readonly themeName: ThemeName
  readonly diffMode: "unified" | "split"
  readonly showThinking: boolean
  readonly totalCostUsd: number
  readonly totalTokens: number
  readonly vimEnabled: boolean
  readonly vimMode: VimMode
  readonly availableModels: readonly ModelInfo[]
  readonly availableCommands: readonly SlashCommand[]
  readonly account: AccountInfo | null
  readonly todoTracker: TodoTrackerState | null
}

export const initialConversationState: ConversationState = {
  sessionId: null,
  sessionState: { status: "idle" },
  startup: {
    auth: { status: "idle" },
    resume: { status: "idle" },
    metadata: { status: "idle" },
  },
  messages: [],
  promptText: "",
  model: "sonnet",
  permissionMode: "default",
  themeName: DEFAULT_THEME_NAME,
  diffMode: "unified",
  showThinking: true,
  totalCostUsd: 0,
  totalTokens: 0,
  vimEnabled: false,
  vimMode: "insert",
  availableModels: [],
  availableCommands: [],
  account: null,
  todoTracker: null,
}

export function getInteractionMode(
  state: Pick<ConversationState, "vimEnabled" | "vimMode">,
): InteractionMode {
  return state.vimEnabled ? state.vimMode : "plain"
}

// ---------------------------------------------------------------------------
// Actions (events that mutate ConversationState)
// ---------------------------------------------------------------------------

export type ConversationAction =
  | { readonly type: "set_session"; readonly sessionId: SessionId }
  | { readonly type: "clear_session" }
  | { readonly type: "set_session_state"; readonly state: SessionState }
  | {
      readonly type: "set_startup_state"
      readonly key: keyof StartupState
      readonly state: StartupTaskState
    }
  | { readonly type: "append_message"; readonly message: DisplayMessage }
  | {
      readonly type: "upsert_task_message"
      readonly task: SpawnedTask
      readonly timestamp: Date
    }
  | { readonly type: "set_prompt_text"; readonly text: string }
  | { readonly type: "update_message_text"; readonly uuid: MessageUUID; readonly text: string }
  | {
      readonly type: "upsert_tool_call_message"
      readonly toolCall: ToolCall
      readonly timestamp: Date
      readonly taskId: string | null
      readonly parentToolUseId: string | null
    }
  | { readonly type: "set_model"; readonly model: string }
  | { readonly type: "set_permission_mode"; readonly mode: string }
  | { readonly type: "set_theme"; readonly themeName: ThemeName }
  | { readonly type: "set_diff_mode"; readonly diffMode: "unified" | "split" }
  | { readonly type: "set_show_thinking"; readonly showThinking: boolean }
  | { readonly type: "update_cost"; readonly costUsd: number; readonly tokens: number }
  | { readonly type: "set_vim_enabled"; readonly enabled: boolean }
  | { readonly type: "set_vim_mode"; readonly mode: VimMode }
  | { readonly type: "set_available_models"; readonly models: readonly ModelInfo[] }
  | { readonly type: "set_available_commands"; readonly commands: readonly SlashCommand[] }
  | { readonly type: "set_account"; readonly account: AccountInfo }
  | { readonly type: "clear_messages" }
  | { readonly type: "set_error"; readonly message: string; readonly recoverable: boolean }
  | { readonly type: "set_message_streaming"; readonly uuid: MessageUUID; readonly isStreaming: boolean }
  | { readonly type: "load_history"; readonly messages: readonly DisplayMessage[] }
  | { readonly type: "update_todo_tracker"; readonly tracker: TodoTrackerState }

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case "set_session":
      return { ...state, sessionId: action.sessionId }

    case "clear_session":
      return { ...state, sessionId: null }

    case "set_session_state":
      return { ...state, sessionState: action.state }

    case "set_startup_state":
      return {
        ...state,
        startup: {
          ...state.startup,
          [action.key]: action.state,
        },
      }

    case "append_message":
      return { ...state, messages: [...state.messages, action.message] }

    case "upsert_task_message": {
      const existingIndex = state.messages.findIndex(
        (message) => message.kind === "task" && message.task.id === action.task.id,
      )

      if (existingIndex === -1) {
        return {
          ...state,
          messages: [
            ...state.messages,
            {
              kind: "task",
              uuid: MessageUUID(`task:${action.task.id}`),
              task: action.task,
              timestamp: action.timestamp,
            },
          ],
        }
      }

      const updated = state.messages.map((message, index) =>
        index === existingIndex && message.kind === "task"
          ? { ...message, task: action.task }
          : message,
      )

      return { ...state, messages: updated }
    }

    case "set_prompt_text":
      return { ...state, promptText: action.text }

    case "update_message_text": {
      const updated = state.messages.map((msg) =>
        (msg.kind === "assistant" || msg.kind === "thinking") && msg.uuid === action.uuid
          ? { ...msg, text: action.text }
          : msg,
      )
      return { ...state, messages: updated }
    }

    case "upsert_tool_call_message": {
      const existingIndex = state.messages.findIndex(
        (message) => message.kind === "tool_call" && message.toolCall.id === action.toolCall.id,
      )

      if (existingIndex === -1) {
        return {
          ...state,
          messages: [
            ...state.messages,
            {
              kind: "tool_call",
              uuid: MessageUUID(`tool:${action.toolCall.id}`),
              toolCall: action.toolCall,
              taskId: action.taskId,
              parentToolUseId: action.parentToolUseId,
              timestamp: action.timestamp,
            },
          ],
        }
      }

      const updated = state.messages.map((message, index) => {
        if (index !== existingIndex || message.kind !== "tool_call") {
          return message
        }

        return {
          ...message,
          toolCall: mergeToolCall(message.toolCall, action.toolCall),
          taskId: action.taskId ?? message.taskId,
          parentToolUseId: action.parentToolUseId ?? message.parentToolUseId,
        }
      })

      return { ...state, messages: updated }
    }

    case "set_model":
      return { ...state, model: action.model }

    case "set_permission_mode":
      return { ...state, permissionMode: action.mode }

    case "set_theme":
      return { ...state, themeName: action.themeName }

    case "set_diff_mode":
      return { ...state, diffMode: action.diffMode }

    case "set_show_thinking":
      return { ...state, showThinking: action.showThinking }

    case "update_cost":
      return {
        ...state,
        totalCostUsd: action.costUsd,
        totalTokens: action.tokens,
      }

    case "set_vim_enabled":
      return { ...state, vimEnabled: action.enabled }

    case "set_vim_mode":
      return { ...state, vimMode: action.mode }

    case "set_available_models":
      return { ...state, availableModels: action.models }

    case "set_available_commands":
      return { ...state, availableCommands: action.commands }

    case "set_account":
      return { ...state, account: action.account }

    case "clear_messages":
      return {
        ...state,
        messages: [],
        totalCostUsd: 0,
        totalTokens: 0,
        todoTracker: null,
      }

    case "set_error":
      return {
        ...state,
        sessionState: { status: "error", message: action.message },
      }

    case "load_history":
      return { ...state, messages: action.messages }

    case "update_todo_tracker":
      return { ...state, todoTracker: action.tracker }

    case "set_message_streaming": {
      const updated = state.messages.map((msg) =>
        (msg.kind === "assistant" || msg.kind === "thinking") && msg.uuid === action.uuid
          ? { ...msg, isStreaming: action.isStreaming }
          : msg,
      )
      return { ...state, messages: updated }
    }
  }
}

function mergeToolCall(existing: ToolCall, incoming: ToolCall): ToolCall {
  const hasIncomingInput = Object.keys(incoming.input).length > 0

  return {
    ...existing,
    ...incoming,
    input: hasIncomingInput ? incoming.input : existing.input,
    output: incoming.output ?? existing.output,
    elapsedSeconds: incoming.elapsedSeconds ?? existing.elapsedSeconds,
    status: mergeToolCallStatus(existing.status, incoming.status),
  }
}

function mergeToolCallStatus(
  existing: ToolCall["status"],
  incoming: ToolCall["status"],
): ToolCall["status"] {
  if (incoming === "error" || incoming === "completed") {
    return incoming
  }

  if (existing === "error" || existing === "completed") {
    return existing
  }

  return incoming
}
