/**
 * Effect-TS services for state management.
 *
 * Pattern:
 *   1. Effect Queue<SDKUserMessage> for prompt input
 *   2. Stream.fromQueue -> Stream.toAsyncIterable as the SDK's prompt param
 *   3. SDK query() returns AsyncGenerator<SDKMessage>
 *   4. Process messages, dispatching ConversationActions
 *   5. React subscribes to state via a callback registry
 */

import { Effect, Queue, Stream } from "effect"
import type {
  SDKUserMessage,
  Query,
  ToolCall,
  Options,
  CanUseTool,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskNotificationMessage,
  SpawnedTask,
  McpServerStatus,
  PermissionResult,
} from "#sdk/types"
import { MessageUUID, SessionId, sessionSummaryFromSDK } from "#sdk/types"
import type { SessionSummary } from "#sdk/types"
import { coalesceSessionMessages } from "#sdk/session-history"
import { projectSessionHistory } from "#state/conversation-history"
import {
  isFinalTaskStatus,
  mergeTaskNotification,
  mergeTaskProgress,
  mergeTaskStarted,
} from "#state/conversation-tasks"
import {
  createSDKMessageContext,
  type MessageScope,
  type StreamingBlockKind,
} from "#state/conversation-streaming"
import {
  handleSDKMessage,
  type SDKMessageHandlerDependencies,
} from "#state/conversation-sdk-handler"
import {
  type AssistantDisplayMessage,
  type ConversationState,
  type ConversationAction,
  type DisplayMessage,
  type ThinkingDisplayMessage,
  type TaskDisplayMessage,
  type ToolCallDisplayMessage,
  type StartupState,
  conversationReducer,
  initialConversationState,
} from "#state/types"
import type { AppConfig } from "#config/schema"
import { saveConfig } from "#config/schema"
import {
  createQuery,
  getQueryMetadata,
  getSessionMessages,
  listSessions,
  loadSupportedMetadata as loadSupportedMetadataFromSDK,
  resumeSession,
  type SupportedMetadata,
} from "#sdk/client"
import type { ThemeName } from "#ui/theme"
import { getErrorMessage } from "#shared/errors"
import {
  isStandardPermissionMode,
  type PermissionModeName,
  type StandardPermissionMode,
} from "#shared/permission-modes"
import { parseSdkSlashCommand } from "#commands/slash"

type ConversationServiceDependencies = {
  readonly createQuery: typeof createQuery
  readonly getQueryMetadata: typeof getQueryMetadata
  readonly getSessionMessages: typeof getSessionMessages
  readonly listSessions: typeof listSessions
  readonly loadSupportedMetadata: typeof loadSupportedMetadataFromSDK
  readonly resumeSession: typeof resumeSession
}

type StartupAuthFailureKind = Extract<StartupState["auth"], { readonly status: "failed" }>["kind"]

const defaultConversationServiceDependencies: ConversationServiceDependencies = {
  createQuery,
  getQueryMetadata,
  getSessionMessages,
  listSessions,
  loadSupportedMetadata: loadSupportedMetadataFromSDK,
  resumeSession,
}

const PLAN_MODE_ALLOWED_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "TaskOutput",
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "ListMcpResources",
  "ReadMcpResource",
])

const PLAN_MODE_SAFE_BASH_PREFIXES = [
  "pwd",
  "ls",
  "stat",
  "which",
  "git status",
  "git diff",
  "git log",
  "git show",
  "git branch",
  "git rev-parse",
  "git ls-files",
  "git grep",
  "rg",
  "env",
  "printenv",
  "uname",
  "date",
  "whoami",
] as const

const PLAN_MODE_BLOCKED_BASH_PATTERNS = [
  /&&/,
  /\|\|/,
  /;/,
  /\|/,
  />/,
  /</,
  /\$\(/,
  /`/,
  /\b(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|ln|install|dd|truncate|tee)\b/,
  /\bgit\s+(add|commit|reset|checkout|switch|restore|clean|stash|rebase|merge|cherry-pick|apply|push|pull|fetch)\b/,
  /\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|rm|update|up|upgrade|uninstall|create|init|x|dlx)\b/,
] as const

// ---------------------------------------------------------------------------
// Subscriber callback type
// ---------------------------------------------------------------------------

type StateListener = (state: ConversationState) => void

// ---------------------------------------------------------------------------
// ConversationService — manages the full lifecycle
// ---------------------------------------------------------------------------

export class ConversationService {
  private state: ConversationState
  private listeners: Set<StateListener> = new Set()
  private promptQueue: Queue.Queue<SDKUserMessage> | null = null
  private activeQuery: Query | null = null
  private metadataLoadPromise: Promise<void> | null = null

  constructor(
    private readonly config: AppConfig,
    initial?: ConversationState,
    private readonly dependencies: ConversationServiceDependencies = defaultConversationServiceDependencies,
  ) {
    this.state = normalizePlanModeState(
      initial ?? {
        ...initialConversationState,
        model: config.defaultModel,
        permissionMode: config.defaultPermissionMode,
        themeName: config.theme,
        diffMode: config.diffMode,
        showThinking: config.showThinking,
        vimEnabled: config.vimEnabled,
      },
    )
  }

  // -------------------------------------------------------------------------
  // State access + subscription
  // -------------------------------------------------------------------------

  getState(): ConversationState {
    return this.state
  }

  getPromptText(): string {
    return this.state.promptText
  }

  beginStartup(options?: { readonly resumeSessionId?: string | null }): void {
    this.setStartupState("auth", { status: "loading" })
    this.setStartupState(
      "resume",
      options?.resumeSessionId ? { status: "loading" } : { status: "idle" },
    )
  }

  markAuthReady(): void {
    this.setStartupState("auth", { status: "ready" })
  }

  markAuthFailed(
    message: string,
    kind: StartupAuthFailureKind = "initialization",
  ): void {
    this.setStartupState("auth", { status: "failed", kind, message })
    this.setStartupState("metadata", { status: "idle" })
    this.setStartupState("resume", { status: "idle" })
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private dispatch(action: ConversationAction): void {
    this.state = conversationReducer(this.state, action)
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }

  private setStartupState<TKey extends keyof StartupState>(
    key: TKey,
    state: StartupState[TKey],
  ): void {
    this.dispatch({ type: "set_startup_state", key, state })
  }

  setPromptText(text: string): void {
    this.dispatch({ type: "set_prompt_text", text })
  }

  setVimEnabled(enabled: boolean): void {
    this.dispatch({ type: "set_vim_enabled", enabled })
    this.dispatch({ type: "set_vim_mode", mode: "insert" })
    saveConfig({ ...this.config, vimEnabled: enabled }).catch(() => {})
  }

  setVimMode(mode: ConversationState["vimMode"]): void {
    this.dispatch({ type: "set_vim_mode", mode })
  }

  appendSystemMessage(text: string): void {
    this.dispatch({
      type: "append_message",
      message: {
        kind: "system",
        uuid: MessageUUID(crypto.randomUUID()),
        text,
        timestamp: new Date(),
      },
    })
  }

  appendErrorMessage(text: string, recoverable = true): void {
    this.dispatch({
      type: "append_message",
      message: {
        kind: "error",
        uuid: MessageUUID(crypto.randomUUID()),
        text,
        recoverable,
        timestamp: new Date(),
      },
    })
  }

  async loadSupportedMetadata(): Promise<void> {
    if (this.hasSupportedMetadata()) {
      this.setStartupState("metadata", { status: "ready" })
      return
    }

    if (!this.metadataLoadPromise) {
      this.setStartupState("metadata", { status: "loading" })
      this.metadataLoadPromise = this.preloadSupportedMetadata().finally(() => {
        this.metadataLoadPromise = null
      })
    }

    await this.metadataLoadPromise
  }

  // -------------------------------------------------------------------------
  // Prompt submission
  // -------------------------------------------------------------------------

  /**
   * Submit a user prompt. If no active query exists, starts a new one.
   */
  async submitPrompt(text: string): Promise<void> {
    const slashCommandMeta = parseSdkSlashCommand(text, this.state.availableCommands)
    const userMessage: DisplayMessage = {
      kind: "user",
      uuid: MessageUUID(crypto.randomUUID()),
      text,
      timestamp: new Date(),
      ...(slashCommandMeta !== null ? { slashCommand: slashCommandMeta } : {}),
    }
    this.dispatch({ type: "append_message", message: userMessage })
    this.dispatch({ type: "set_session_state", state: { status: "running" } })

    if (this.promptQueue) {
      // Active multi-turn query — push to queue
      const sdkMsg: SDKUserMessage = {
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      }
      await Effect.runPromise(Queue.offer(this.promptQueue, sdkMsg))
    } else {
      // Start a new query
      await this.startQuery(text)
    }
  }

  async submitCurrentPrompt(): Promise<void> {
    const text = this.state.promptText.trim()
    if (!text) return
    this.dispatch({ type: "set_prompt_text", text: "" })
    await this.submitPrompt(text)
  }

  /**
   * Start a fresh query (new session or initial prompt).
   */
  private async startQuery(initialPrompt: string): Promise<void> {
    // Create the prompt queue for multi-turn
    const queue = await Effect.runPromise(Queue.unbounded<SDKUserMessage>())
    this.promptQueue = queue

    // Push the initial prompt
    const sdkMsg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: initialPrompt },
      parent_tool_use_id: null,
    }
    await Effect.runPromise(Queue.offer(queue, sdkMsg))

    // Create async iterable from queue for the SDK
    const promptIterable = this.createPromptIterable(queue)

    // Build permission callback
    const canUseTool = this.buildCanUseTool()

    // Start the SDK query
    const q = this.dependencies.createQuery(this.config, {
      prompt: promptIterable,
      options: this.getQueryOptions(canUseTool),
    })
    this.activeQuery = q

    // Process the output stream (fire-and-forget, errors handled internally)
    this.processQueryOutput(q)
  }

  /**
   * Resume an existing session.
   */
  async startResumeSession(sessionId: string): Promise<void> {
    this.setStartupState("resume", { status: "loading" })
    await this.cleanup()

    try {
      const history = coalesceSessionMessages(await this.dependencies.getSessionMessages(sessionId))
      const historyState = projectSessionHistory(history)

      this.dispatch({ type: "load_history", messages: historyState.messages })
      if (historyState.todoTracker) {
        this.dispatch({ type: "update_todo_tracker", tracker: historyState.todoTracker })
      }
      this.dispatch({ type: "set_session", sessionId: SessionId(sessionId) })

      const queue = await Effect.runPromise(Queue.unbounded<SDKUserMessage>())
      this.promptQueue = queue

      const promptIterable = this.createPromptIterable(queue)
      const canUseTool = this.buildCanUseTool()

      const q = this.dependencies.resumeSession(
        this.config,
        sessionId,
        promptIterable,
        this.getQueryOptions(canUseTool),
      )
      this.activeQuery = q
      this.setStartupState("resume", { status: "ready" })
      this.processQueryOutput(q)
    } catch (error) {
      this.setStartupState("resume", { status: "failed", message: getErrorMessage(error) })
      throw error
    }
  }

  async loadSession(sessionId: string): Promise<void> {
    this.dispatch({ type: "set_prompt_text", text: "" })
    this.dispatch({ type: "set_session_state", state: { status: "idle" } })
    await this.startResumeSession(sessionId)
  }

  async listSessionSummaries(): Promise<readonly SessionSummary[]> {
    const sessions = await this.dependencies.listSessions()
    return sessions.map(sessionSummaryFromSDK)
  }

  async setPermissionMode(mode: PermissionModeName): Promise<void> {
    if (mode === "plan") {
      await this.enterPlanMode()
      return
    }

    if (this.state.planMode.active) {
      await this.restorePlanPermissionMode(mode)
      return
    }

    if (this.state.permissionMode === mode) {
      return
    }

    await this.forwardPermissionMode(mode)
    this.dispatch({ type: "set_permission_mode", mode })
  }

  async enterPlanMode(): Promise<void> {
    if (this.state.planMode.active) {
      return
    }

    const previousPermissionMode = this.getCurrentStandardPermissionMode()
    await this.forwardPermissionMode("plan")
    this.dispatch({
      type: "enter_plan_mode",
      previousPermissionMode,
    })
  }

  async togglePlanMode(): Promise<"entered" | "exited" | "cancelled"> {
    if (this.state.planMode.active) {
      const allowed = await this.requestPlanModeExit("user")
      return allowed ? "exited" : "cancelled"
    }

    await this.enterPlanMode()
    return "entered"
  }

  async requestPlanModeExit(source: "assistant" | "user" = "user"): Promise<boolean> {
    if (!this.state.planMode.active) {
      return true
    }

    const allowed = await this.requestPermission({
      kind: "plan_exit",
      toolName: "ExitPlanMode",
      toolInput: {},
      ...(source === "assistant"
        ? {
            title: "Claude wants to exit plan mode.",
          }
        : {
            title: "Exit plan mode and restore write access?",
            description: "Approve to restore your previous permission mode and let Claude apply the plan.",
          }),
    })

    if (!allowed) {
      return false
    }

    await this.restorePlanPermissionMode()
    return true
  }

  setTheme(themeName: ThemeName): void {
    this.dispatch({ type: "set_theme", themeName })
  }

  toggleDiffMode(): "unified" | "split" {
    const nextMode = this.state.diffMode === "unified" ? "split" : "unified"
    this.dispatch({ type: "set_diff_mode", diffMode: nextMode })
    return nextMode
  }

  setShowThinking(showThinking: boolean): void {
    this.dispatch({ type: "set_show_thinking", showThinking })
  }

  toggleThinkingVisibility(): boolean {
    const nextValue = !this.state.showThinking
    this.dispatch({ type: "set_show_thinking", showThinking: nextValue })
    return nextValue
  }

  clearMessages(): void {
    this.dispatch({ type: "clear_messages" })
  }

  private async forwardPermissionMode(mode: PermissionModeName): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.setPermissionMode(mode)
    }
  }

  private getFallbackStandardPermissionMode(): StandardPermissionMode {
    return isStandardPermissionMode(this.config.defaultPermissionMode)
      ? this.config.defaultPermissionMode
      : "default"
  }

  private getCurrentStandardPermissionMode(): StandardPermissionMode {
    return isStandardPermissionMode(this.state.permissionMode)
      ? this.state.permissionMode
      : this.state.planMode.previousPermissionMode ?? this.getFallbackStandardPermissionMode()
  }

  private getNonBypassFallbackStandardPermissionMode(): StandardPermissionMode {
    const fallbackMode = this.getFallbackStandardPermissionMode()
    return fallbackMode === "bypassPermissions" ? "default" : fallbackMode
  }

  private async restorePlanPermissionMode(
    mode: StandardPermissionMode = this.state.planMode.previousPermissionMode
      ?? this.getFallbackStandardPermissionMode(),
  ): Promise<void> {
    try {
      await this.forwardPermissionMode(mode)
      this.dispatch({ type: "exit_plan_mode", mode })
    } catch (error) {
      if (!shouldFallbackFromUnsupportedBypassPermissions(mode, error)) {
        throw error
      }

      const fallbackMode = this.getNonBypassFallbackStandardPermissionMode()
      await this.forwardPermissionMode(fallbackMode)
      this.dispatch({ type: "exit_plan_mode", mode: fallbackMode })
      this.appendSystemMessage(
        `bypassPermissions is unavailable for this session. Restored ${fallbackMode} permission mode instead.`,
      )
    }
  }

  private requestPermission(request: {
    readonly kind: "tool" | "plan_exit"
    readonly toolName: string
    readonly toolInput: Record<string, unknown>
    readonly title?: string
    readonly description?: string
    readonly onAllow?: () => Promise<void>
  }): Promise<boolean> {
    const resumeStatus = this.state.sessionState.status === "running" ? "running" : "idle"

    return new Promise<boolean>((resolve, reject) => {
      this.dispatch({
        type: "set_session_state",
        state: {
          status: "awaiting_permission",
          request: {
            ...request,
            resumeStatus,
            resolve: async (allowed) => {
              let requestError: unknown = null

              try {
                if (allowed) {
                  await request.onAllow?.()
                }
              } catch (error) {
                requestError = error
              } finally {
                this.dispatch({
                  type: "set_session_state",
                  state: { status: resumeStatus },
                })
              }

              if (requestError) {
                reject(requestError)
                return
              }

              resolve(allowed)
            },
          },
        },
      })
    })
  }

  // -------------------------------------------------------------------------
  // Permission handling
  // -------------------------------------------------------------------------

  private buildCanUseTool() {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      options: {
        signal: AbortSignal
        title?: string
        description?: string
        displayName?: string
        toolUseID: string
        [key: string]: unknown
      },
    ): Promise<PermissionResult> => {
      if (this.state.planMode.active) {
        if (toolName === "ExitPlanMode") {
          const allowed = await this.requestPermission({
            kind: "plan_exit",
            toolName,
            toolInput: input,
            title: options.title ?? "Claude wants to exit plan mode.",
            ...(options.description ? { description: options.description } : {}),
            onAllow: async () => {
              await this.restorePlanPermissionMode()
            },
          })

          if (!allowed) {
            return {
              behavior: "deny",
              message: "Plan mode stays active until you approve exiting it.",
            }
          }

          return { behavior: "allow" }
        }

        return getPlanModeToolPermission(toolName, input)
      }

      return { behavior: "allow" }
    }
  }

  /**
   * Resolve a pending permission prompt.
   */
  resolvePermission(allowed: boolean): void {
    if (this.state.sessionState.status === "awaiting_permission") {
      this.state.sessionState.request.resolve(allowed)
    }
  }

  // -------------------------------------------------------------------------
  // SDK output processing
  // -------------------------------------------------------------------------

  private async processQueryOutput(q: Query): Promise<void> {
    const ctx = createSDKMessageContext()
    const handlerDependencies = this.createSDKMessageHandlerDependencies()

    try {
      // Fetch available models and commands from the query
      void this.fetchQueryMetadata(q)

      for await (const msg of q) {
        handleSDKMessage(msg, ctx, handlerDependencies)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.appendErrorMessage(message)
    } finally {
      if (this.state.sessionState.status !== "error") {
        this.dispatch({ type: "set_session_state", state: { status: "idle" } })
      }
    }
  }

  private upsertTranscriptTextMessage(options: {
    readonly kind: StreamingBlockKind
    readonly uuid: MessageUUID
    readonly text: string
    readonly isStreaming: boolean
    readonly timestamp: Date
    readonly scope: MessageScope
  }): void {
    const existing = this.getTranscriptTextMessage(options.uuid)

    if (!existing) {
      if (options.text.length === 0) {
        return
      }

      this.dispatch({
        type: "append_message",
        message: {
          kind: options.kind,
          uuid: options.uuid,
          text: options.text,
          isStreaming: options.isStreaming,
          timestamp: options.timestamp,
          taskId: options.scope.taskId,
          parentToolUseId: options.scope.parentToolUseId,
        },
      })
      return
    }

    if (existing.text !== options.text) {
      this.dispatch({
        type: "update_message_text",
        uuid: options.uuid,
        text: options.text,
      })
    }

    if (existing.isStreaming !== options.isStreaming) {
      this.setMessageStreaming(options.uuid, options.isStreaming)
    }
  }

  private upsertToolCallMessage(toolCall: ToolCall, scope: MessageScope, timestamp: Date): void {
    if (toolCall.status === "running") {
      this.finalizeOtherRunningToolCallsForScope(scope, toolCall.id, "completed")
    }

    this.dispatch({
      type: "upsert_tool_call_message",
      toolCall,
      timestamp,
      taskId: scope.taskId,
      parentToolUseId: scope.parentToolUseId,
    })
  }

  private resolveMessageScope(parentToolUseId: string | null, taskId: string | null = null): MessageScope {
    return {
      taskId: taskId ?? this.getTaskIdForParentToolUseId(parentToolUseId),
      parentToolUseId: parentToolUseId,
    }
  }

  private getTaskIdForParentToolUseId(parentToolUseId: string | null): string | null {
    if (!parentToolUseId) {
      return null
    }

    for (const message of this.state.messages) {
      if (message.kind === "task" && message.task.toolUseId === parentToolUseId) {
        return message.task.id
      }
    }

    return null
  }

  private getTranscriptTextMessage(
    uuid: MessageUUID,
  ): AssistantDisplayMessage | ThinkingDisplayMessage | null {
    for (const message of this.state.messages) {
      if (
        (message.kind === "assistant" || message.kind === "thinking") &&
        message.uuid === uuid
      ) {
        return message
      }
    }

    return null
  }

  private setMessageStreaming(uuid: MessageUUID, isStreaming: boolean): void {
    this.dispatch({
      type: "set_message_streaming",
      uuid,
      isStreaming,
    })
  }

  private getLatestReusableTranscriptTextMessage(
    kind: StreamingBlockKind,
    scope: MessageScope,
  ): AssistantDisplayMessage | ThinkingDisplayMessage | null {
    const lastMessage = this.state.messages.at(-1)

    if (
      lastMessage &&
      (lastMessage.kind === "assistant" || lastMessage.kind === "thinking") &&
      lastMessage.kind === kind &&
      lastMessage.isStreaming &&
      lastMessage.taskId === scope.taskId &&
      lastMessage.parentToolUseId === scope.parentToolUseId
    ) {
      return lastMessage
    }

    return null
  }

  private async fetchQueryMetadata(q: Query): Promise<void> {
    try {
      const metadata = await this.dependencies.getQueryMetadata(q)
      this.applySupportedMetadata(metadata)
    } catch {
      // Non-fatal
    }
  }

  private applySupportedMetadata(metadata: SupportedMetadata): void {
    this.dispatch({ type: "set_available_commands", commands: metadata.commands })
    this.dispatch({ type: "set_available_models", models: metadata.models })
    this.dispatch({ type: "set_account", account: metadata.account })
    this.setStartupState("metadata", { status: "ready" })
  }

  private hasSupportedMetadata(): boolean {
    return (
      this.state.availableCommands.length > 0 &&
      this.state.availableModels.length > 0 &&
      this.state.account !== null
    )
  }

  private async preloadSupportedMetadata(): Promise<void> {
    try {
      const metadata = await this.dependencies.loadSupportedMetadata(this.config)
      this.applySupportedMetadata(metadata)
    } catch (error) {
      this.setStartupState("metadata", { status: "failed", message: getErrorMessage(error) })
    }
  }

  // -------------------------------------------------------------------------
  // Session management
  // -------------------------------------------------------------------------

  async newSession(): Promise<void> {
    await this.cleanup()
    this.dispatch({ type: "clear_messages" })
    this.dispatch({ type: "set_prompt_text", text: "" })
    this.dispatch({ type: "clear_session" })
    this.dispatch({ type: "set_session_state", state: { status: "idle" } })
    this.setStartupState("resume", { status: "idle" })
  }

  async interrupt(): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.interrupt()
    }
  }

  async setModel(model: string): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.setModel(model)
    }
    this.dispatch({ type: "set_model", model })
  }

  async getMcpServerStatus(): Promise<McpServerStatus[]> {
    return this.getActiveQueryOrThrow().mcpServerStatus()
  }

  async reconnectMcpServer(serverName: string): Promise<void> {
    return this.getActiveQueryOrThrow().reconnectMcpServer(serverName)
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    return this.getActiveQueryOrThrow().toggleMcpServer(serverName, enabled)
  }

  private getActiveQueryOrThrow(): Query {
    if (!this.activeQuery) {
      throw new Error("No active session. Start a conversation first.")
    }
    return this.activeQuery
  }

  private getQueryOptions(canUseTool: CanUseTool): Partial<Options> {
    return {
      canUseTool,
      model: this.state.model,
      permissionMode: this.state.permissionMode as never,
      ...(this.state.permissionMode === "bypassPermissions"
        || this.state.planMode.previousPermissionMode === "bypassPermissions"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  async cleanup(): Promise<void> {
    if (this.activeQuery) {
      this.activeQuery.close()
      this.activeQuery = null
    }
    if (this.promptQueue) {
      await Effect.runPromise(Queue.shutdown(this.promptQueue))
      this.promptQueue = null
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert an Effect Queue to an AsyncIterable for the SDK.
   * In Effect v3, Stream.toAsyncIterable returns AsyncIterable directly.
   */
  private createPromptIterable(
    queue: Queue.Queue<SDKUserMessage>,
  ): AsyncIterable<SDKUserMessage> {
    const stream = Stream.fromQueue(queue)
    return Stream.toAsyncIterable(stream)
  }

  private createSDKMessageHandlerDependencies(): SDKMessageHandlerDependencies {
    return {
      appendErrorMessage: this.appendErrorMessage.bind(this),
      appendSystemMessage: this.appendSystemMessage.bind(this),
      dispatch: this.dispatch.bind(this),
      finalizeAllRunningToolCalls: this.finalizeAllRunningToolCalls.bind(this),
      finalizeRunningToolCallsForScope: this.finalizeRunningToolCallsForScope.bind(this),
      getLatestReusableTranscriptTextMessage: this.getLatestReusableTranscriptTextMessage.bind(this),
      getToolCallMessage: this.getToolCallMessage.bind(this),
      getTranscriptTextMessage: this.getTranscriptTextMessage.bind(this),
      handleTaskNotificationMessage: this.handleTaskNotificationMessage.bind(this),
      handleTaskProgressMessage: this.handleTaskProgressMessage.bind(this),
      handleTaskStartedMessage: this.handleTaskStartedMessage.bind(this),
      resolveMessageScope: this.resolveMessageScope.bind(this),
      setMessageStreaming: this.setMessageStreaming.bind(this),
      updateToolCallById: this.updateToolCallById.bind(this),
      upsertToolCallMessage: this.upsertToolCallMessage.bind(this),
      upsertTranscriptTextMessage: this.upsertTranscriptTextMessage.bind(this),
    }
  }

  private getTaskMessage(taskId: string): TaskDisplayMessage | null {
    for (const message of this.state.messages) {
      if (message.kind === "task" && message.task.id === taskId) {
        return message
      }
    }

    return null
  }

  private upsertTaskMessage(
    taskId: string,
    updater: (task: SpawnedTask | null) => SpawnedTask,
  ): SpawnedTask {
    const existing = this.getTaskMessage(taskId)
    const nextTask = updater(existing?.task ?? null)

    this.dispatch({
      type: "upsert_task_message",
      task: nextTask,
      timestamp: existing?.timestamp ?? new Date(),
    })

    return nextTask
  }

  private handleTaskStartedMessage(message: SDKTaskStartedMessage): void {
    const task = this.upsertTaskMessage(message.task_id, (current) => mergeTaskStarted(current, message))
    this.reconcileToolRowsForTask(task.id, task.toolUseId)
  }

  private handleTaskProgressMessage(message: SDKTaskProgressMessage): void {
    const task = this.upsertTaskMessage(message.task_id, (current) => mergeTaskProgress(current, message))
    this.reconcileToolRowsForTask(task.id, task.toolUseId)
  }

  private handleTaskNotificationMessage(message: SDKTaskNotificationMessage): void {
    const task = this.upsertTaskMessage(message.task_id, (current) => mergeTaskNotification(current, message))
    this.reconcileToolRowsForTask(task.id, task.toolUseId)
    if (isFinalTaskStatus(task.status)) {
      this.finalizeRunningToolCallsForTask(
        task.id,
        task.status === "failed" ? "error" : "completed",
      )
    }
  }

  private reconcileToolRowsForTask(taskId: string, parentToolUseId: string | null): void {
    if (!parentToolUseId) {
      return
    }

    for (const message of this.state.messages) {
      if (
        message.kind !== "tool_call" ||
        message.taskId === taskId ||
        message.parentToolUseId !== parentToolUseId
      ) {
        continue
      }

      this.dispatch({
        type: "upsert_tool_call_message",
        toolCall: message.toolCall,
        timestamp: message.timestamp,
        taskId,
        parentToolUseId: message.parentToolUseId,
      })
    }
  }

  private getToolCallMessage(toolCallId: string): ToolCallDisplayMessage | null {
    for (const message of this.state.messages) {
      if (message.kind === "tool_call" && message.toolCall.id === toolCallId) {
        return message
      }
    }

    return null
  }

  private updateToolCallById(
    toolCallId: string,
    updater: (toolCall: ToolCall) => ToolCall,
  ): void {
    const message = this.getToolCallMessage(toolCallId)
    if (!message) {
      return
    }

    this.dispatch({
      type: "upsert_tool_call_message",
      toolCall: updater(message.toolCall),
      timestamp: message.timestamp,
      taskId: message.taskId,
      parentToolUseId: message.parentToolUseId,
    })
  }

  private finalizeRunningToolCallsForScope(
    scope: MessageScope,
    status: Exclude<ToolCall["status"], "running">,
  ): void {
    this.finalizeRunningToolCalls(
      (message) =>
        message.taskId === scope.taskId && message.parentToolUseId === scope.parentToolUseId,
      status,
    )
  }

  private finalizeOtherRunningToolCallsForScope(
    scope: MessageScope,
    activeToolUseId: string,
    status: Exclude<ToolCall["status"], "running">,
  ): void {
    this.finalizeRunningToolCalls(
      (message) =>
        message.toolCall.id !== activeToolUseId &&
        message.taskId === scope.taskId &&
        message.parentToolUseId === scope.parentToolUseId,
      status,
    )
  }

  private finalizeRunningToolCallsForTask(
    taskId: string,
    status: Exclude<ToolCall["status"], "running">,
  ): void {
    this.finalizeRunningToolCalls((message) => message.taskId === taskId, status)
  }

  private finalizeAllRunningToolCalls(
    status: Exclude<ToolCall["status"], "running">,
  ): void {
    this.finalizeRunningToolCalls(() => true, status)
  }

  private finalizeRunningToolCalls(
    predicate: (message: ToolCallDisplayMessage) => boolean,
    status: Exclude<ToolCall["status"], "running">,
  ): void {
    const runningToolIds = this.state.messages
      .filter(
        (message): message is ToolCallDisplayMessage =>
          message.kind === "tool_call" && message.toolCall.status === "running" && predicate(message),
      )
      .map((message) => message.toolCall.id)

    for (const toolCallId of runningToolIds) {
      this.updateToolCallById(toolCallId, (toolCall) => ({
        ...toolCall,
        status,
      }))
    }
  }
}

function normalizePlanModeState(state: ConversationState): ConversationState {
  if (state.permissionMode === "plan") {
    return {
      ...state,
      planMode: {
        active: true,
        previousPermissionMode: state.planMode.previousPermissionMode,
      },
    }
  }

  return {
    ...state,
    planMode: {
      active: false,
      previousPermissionMode: null,
    },
  }
}

function shouldFallbackFromUnsupportedBypassPermissions(
  mode: StandardPermissionMode,
  error: unknown,
): boolean {
  if (mode !== "bypassPermissions") {
    return false
  }

  const message = getErrorMessage(error)
  return message.includes("Cannot set permission mode to bypassPermissions")
    && message.includes("--dangerously-skip-permissions")
}

function getPlanModeToolPermission(
  toolName: string,
  input: Record<string, unknown>,
): PermissionResult {
  if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
    return { behavior: "allow" }
  }

  if (toolName === "Bash") {
    return getPlanModeBashPermission(input)
  }

  if (toolName === "Task" || toolName === "Agent" || toolName === "SpawnAgent") {
    return {
      behavior: "deny",
      message: "Plan mode is read-only. Child agents are disabled until plan mode exits.",
    }
  }

  if (toolName.startsWith("mcp__") || toolName === "Mcp") {
    return {
      behavior: "deny",
      message: "Plan mode is read-only. MCP tool calls are blocked unless they are explicitly surfaced as read-only tools.",
    }
  }

  return {
    behavior: "deny",
    message: `Plan mode is read-only. ${toolName} is blocked until plan mode exits.`,
  }
}

function getPlanModeBashPermission(input: Record<string, unknown>): PermissionResult {
  const command = typeof input["command"] === "string" ? input["command"].trim() : ""

  if (!command) {
    return {
      behavior: "deny",
      message: "Plan mode only allows clearly read-only Bash commands.",
    }
  }

  if (PLAN_MODE_BLOCKED_BASH_PATTERNS.some((pattern) => pattern.test(command))) {
    return {
      behavior: "deny",
      message: "Plan mode only allows read-only Bash commands. This command looks mutating.",
    }
  }

  const normalized = command.toLowerCase()
  if (!PLAN_MODE_SAFE_BASH_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `))) {
    return {
      behavior: "deny",
      message: "Plan mode only allows a small set of read-only Bash commands.",
    }
  }

  return { behavior: "allow" }
}
