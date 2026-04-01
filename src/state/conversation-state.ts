import { MessageUUID } from "#sdk/types"
import type {
  AccountInfo,
  ModelInfo,
  PermissionRequest,
  SessionId,
  SlashCommand,
  SpawnedTask,
  TodoTrackerState,
  ToolCall,
} from "#sdk/types"
import type { PermissionModeName, StandardPermissionMode } from "#shared/permission-modes"
import { DEFAULT_THEME_NAME, type ThemeName } from "#ui/theme"

export type VimMode = "insert" | "normal"

export type InteractionMode = "plain" | VimMode

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

export type PlanModeState = {
  readonly active: boolean
  readonly previousPermissionMode: StandardPermissionMode | null
}

export type ConversationState = {
  readonly sessionId: SessionId | null
  readonly sessionState: SessionState
  readonly startup: StartupState
  readonly messages: readonly DisplayMessage[]
  readonly promptText: string
  readonly model: string
  readonly permissionMode: PermissionModeName
  readonly planMode: PlanModeState
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
  planMode: {
    active: false,
    previousPermissionMode: null,
  },
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

export function isPlanModeActive(
  state: Pick<ConversationState, "planMode">,
): boolean {
  return state.planMode.active
}
