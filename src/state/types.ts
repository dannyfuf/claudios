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
} from "#sdk/types"
import { DEFAULT_THEME_NAME, type ThemeName } from "#ui/theme"

// ---------------------------------------------------------------------------
// Vim mode
// ---------------------------------------------------------------------------

export type VimMode = "insert" | "normal"

// ---------------------------------------------------------------------------
// Display message types (what the UI renders)
// ---------------------------------------------------------------------------

export type DisplayMessage =
  | UserDisplayMessage
  | AssistantDisplayMessage
  | SystemDisplayMessage
  | TaskDisplayMessage
  | ErrorDisplayMessage

export type UserDisplayMessage = {
  readonly kind: "user"
  readonly uuid: MessageUUID
  readonly text: string
  readonly timestamp: Date
}

export type AssistantDisplayMessage = {
  readonly kind: "assistant"
  readonly uuid: MessageUUID
  readonly text: string
  readonly toolCalls: readonly ToolCall[]
  readonly isStreaming: boolean
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
  readonly streamingText: string
  readonly model: string
  readonly permissionMode: string
  readonly themeName: ThemeName
  readonly diffMode: "unified" | "split"
  readonly totalCostUsd: number
  readonly totalTokens: number
  readonly vimMode: VimMode
  readonly availableModels: readonly ModelInfo[]
  readonly availableCommands: readonly SlashCommand[]
  readonly account: AccountInfo | null
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
  streamingText: "",
  model: "sonnet",
  permissionMode: "default",
  themeName: DEFAULT_THEME_NAME,
  diffMode: "unified",
  totalCostUsd: 0,
  totalTokens: 0,
  vimMode: "insert",
  availableModels: [],
  availableCommands: [],
  account: null,
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
  | { readonly type: "update_streaming_text"; readonly text: string }
  | {
      readonly type: "finalize_assistant_message"
      readonly uuid: MessageUUID
      readonly text: string
      readonly toolCalls: readonly ToolCall[]
    }
  | { readonly type: "update_tool_call"; readonly messageUuid: MessageUUID; readonly toolCall: ToolCall }
  | { readonly type: "set_model"; readonly model: string }
  | { readonly type: "set_permission_mode"; readonly mode: string }
  | { readonly type: "set_theme"; readonly themeName: ThemeName }
  | { readonly type: "set_diff_mode"; readonly diffMode: "unified" | "split" }
  | { readonly type: "update_cost"; readonly costUsd: number; readonly tokens: number }
  | { readonly type: "set_vim_mode"; readonly mode: VimMode }
  | { readonly type: "set_available_models"; readonly models: readonly ModelInfo[] }
  | { readonly type: "set_available_commands"; readonly commands: readonly SlashCommand[] }
  | { readonly type: "set_account"; readonly account: AccountInfo }
  | { readonly type: "clear_messages" }
  | { readonly type: "set_error"; readonly message: string; readonly recoverable: boolean }
  | { readonly type: "set_message_streaming"; readonly uuid: MessageUUID; readonly isStreaming: boolean }
  | { readonly type: "load_history"; readonly messages: readonly DisplayMessage[] }

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

    case "update_streaming_text":
      return { ...state, streamingText: action.text }

    case "finalize_assistant_message": {
      const updated = state.messages.map((msg) =>
        msg.kind === "assistant" && msg.uuid === action.uuid
          ? { ...msg, text: action.text, toolCalls: action.toolCalls, isStreaming: false }
          : msg,
      )
      return { ...state, messages: updated, streamingText: "" }
    }

    case "update_tool_call": {
      const updated = state.messages.map((msg) => {
        if (msg.kind !== "assistant" || msg.uuid !== action.messageUuid) return msg
        const existingIndex = msg.toolCalls.findIndex((tc) => tc.id === action.toolCall.id)
        const toolCalls =
          existingIndex === -1
            ? [...msg.toolCalls, action.toolCall]
            : msg.toolCalls.map((tc) =>
                tc.id === action.toolCall.id ? action.toolCall : tc,
              )
        return { ...msg, toolCalls }
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

    case "update_cost":
      return {
        ...state,
        totalCostUsd: action.costUsd,
        totalTokens: action.tokens,
      }

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
        streamingText: "",
        totalCostUsd: 0,
        totalTokens: 0,
      }

    case "set_error":
      return {
        ...state,
        sessionState: { status: "error", message: action.message },
      }

    case "load_history":
      return { ...state, messages: action.messages }

    case "set_message_streaming": {
      const updated = state.messages.map((msg) =>
        msg.kind === "assistant" && msg.uuid === action.uuid
          ? { ...msg, isStreaming: action.isStreaming }
          : msg,
      )
      return { ...state, messages: updated }
    }
  }
}
