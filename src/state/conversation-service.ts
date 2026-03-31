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

import { Effect, Queue, Stream, Deferred } from "effect"
import type {
  SDKUserMessage,
  SDKMessage,
  Query,
  ToolCall,
  Options,
  CanUseTool,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskNotificationMessage,
  SpawnedTask,
  McpServerStatus,
} from "#sdk/types"
import { MessageUUID, SessionId, sessionSummaryFromSDK } from "#sdk/types"
import type { SessionSummary } from "#sdk/types"
import { extractToolResultIds, normalizeFileToolResult } from "#sdk/tool-result"
import {
  type AssistantDisplayMessage,
  type ConversationState,
  type ConversationAction,
  type DisplayMessage,
  type ThinkingDisplayMessage,
  type TaskDisplayMessage,
  type ToolCallDisplayMessage,
  type StartupState,
  type StartupTaskState,
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

type ConversationServiceDependencies = {
  readonly createQuery: typeof createQuery
  readonly getQueryMetadata: typeof getQueryMetadata
  readonly getSessionMessages: typeof getSessionMessages
  readonly listSessions: typeof listSessions
  readonly loadSupportedMetadata: typeof loadSupportedMetadataFromSDK
  readonly resumeSession: typeof resumeSession
}

type MessageScope = {
  readonly taskId: string | null
  readonly parentToolUseId: string | null
}

type StreamingBlockKind = "assistant" | "thinking"

type StreamingBlockState = {
  readonly rowUuid: MessageUUID
  readonly kind: StreamingBlockKind
  readonly text: string
}

type SDKMessageContext = {
  readonly streamingBlocks: Map<string, StreamingBlockState>
}

const defaultConversationServiceDependencies: ConversationServiceDependencies = {
  createQuery,
  getQueryMetadata,
  getSessionMessages,
  listSessions,
  loadSupportedMetadata: loadSupportedMetadataFromSDK,
  resumeSession,
}

// ---------------------------------------------------------------------------
// Subscriber callback type
// ---------------------------------------------------------------------------

type StateListener = (state: ConversationState) => void

// ---------------------------------------------------------------------------
// PermissionResult (matches SDK's PermissionResult type)
// ---------------------------------------------------------------------------

type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string }

// ---------------------------------------------------------------------------
// ConversationService — manages the full lifecycle
// ---------------------------------------------------------------------------

export class ConversationService {
  private state: ConversationState
  private listeners: Set<StateListener> = new Set()
  private promptQueue: Queue.Queue<SDKUserMessage> | null = null
  private activeQuery: Query | null = null
  private permissionDeferred: Deferred.Deferred<boolean, never> | null = null
  private metadataLoadPromise: Promise<void> | null = null

  constructor(
    private readonly config: AppConfig,
    initial?: ConversationState,
    private readonly dependencies: ConversationServiceDependencies = defaultConversationServiceDependencies,
  ) {
    this.state =
      initial ?? {
        ...initialConversationState,
        model: config.defaultModel,
        permissionMode: config.defaultPermissionMode,
        themeName: config.theme,
        diffMode: config.diffMode,
        showThinking: config.showThinking,
        vimEnabled: config.vimEnabled,
      }
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

  markAuthFailed(message: string): void {
    this.setStartupState("auth", { status: "failed", message })
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

  private setStartupState(key: keyof StartupState, state: StartupTaskState): void {
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
    const userMessage: DisplayMessage = {
      kind: "user",
      uuid: MessageUUID(crypto.randomUUID()),
      text,
      timestamp: new Date(),
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
      const history = await this.dependencies.getSessionMessages(sessionId)
      const historyMessages = projectSessionHistory(history)

      this.dispatch({ type: "load_history", messages: historyMessages })
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

  async setPermissionMode(mode: string): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.setPermissionMode(mode as never)
    }
    this.dispatch({ type: "set_permission_mode", mode })
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

  // -------------------------------------------------------------------------
  // Permission handling
  // -------------------------------------------------------------------------

  private buildCanUseTool() {
    return async (
      _toolName: string,
      _input: Record<string, unknown>,
      _options: {
        signal: AbortSignal
        title?: string
        description?: string
        displayName?: string
        toolUseID: string
        [key: string]: unknown
      },
    ): Promise<PermissionResult> => {
      // Yolo mode: auto-approve all tool calls without prompting
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
    const ctx: SDKMessageContext = {
      streamingBlocks: new Map(),
    }

    try {
      // Fetch available models and commands from the query
      this.fetchQueryMetadata(q)

      for await (const msg of q) {
        this.handleSDKMessage(msg, ctx)
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

  private handleSDKMessage(
    msg: SDKMessage,
    ctx: SDKMessageContext,
  ): void {
    switch (msg.type) {
      case "assistant": {
        this.handleAssistantMessage(msg, ctx)
        break
      }

      case "user": {
        this.handleUserMessage(msg)
        break
      }

      case "stream_event": {
        this.handleStreamEventMessage(msg, ctx)
        break
      }

      case "result": {
        if (msg.subtype === "success") {
          this.dispatch({
            type: "update_cost",
            costUsd: msg.total_cost_usd,
            tokens: msg.usage.input_tokens + msg.usage.output_tokens,
          })
          this.finalizeAllRunningToolCalls("completed")
          if (msg.session_id) {
            this.dispatch({
              type: "set_session",
              sessionId: SessionId(msg.session_id),
            })
          }
        } else {
          this.finalizeAllRunningToolCalls("error")
          this.appendErrorMessage(
            msg.errors.length > 0 ? msg.errors.join("\n") : "Query failed",
          )
        }
        this.dispatch({ type: "set_session_state", state: { status: "idle" } })
        break
      }

      case "system": {
        switch (msg.subtype) {
          case "init": {
            const initMsg = msg as Record<string, unknown>
            if (typeof initMsg["model"] === "string") {
              this.dispatch({ type: "set_model", model: initMsg["model"] })
            }
            if (typeof initMsg["session_id"] === "string") {
              this.dispatch({
                type: "set_session",
                sessionId: SessionId(initMsg["session_id"]),
              })
            }
            break
          }

          case "local_command_output": {
            this.appendSystemMessage(msg.content)
            break
          }

          case "task_started": {
            this.handleTaskStartedMessage(msg)
            break
          }

          case "task_progress": {
            this.handleTaskProgressMessage(msg)
            break
          }

          case "task_notification": {
            this.handleTaskNotificationMessage(msg)
            break
          }

          default:
            break
        }
        break
      }

      case "tool_progress": {
        this.handleToolProgressMessage(msg)
        break
      }

      case "tool_use_summary": {
        this.handleToolUseSummaryMessage(msg)
        break
      }

      default:
        break
    }
  }

  private handleAssistantMessage(
    msg: Extract<SDKMessage, { readonly type: "assistant" }>,
    ctx: SDKMessageContext,
  ): void {
    const timestamp = new Date()
    const scope = this.resolveMessageScope(msg.parent_tool_use_id)
    const blocks = extractAssistantBlocks(msg.uuid, msg.message, {
      defaultToolStatus: "running",
    })
    let hasFinalizedScopeTools = false

    for (const block of blocks) {
      switch (block.kind) {
        case "assistant":
        case "thinking":
          if (!hasFinalizedScopeTools) {
            this.finalizeRunningToolCallsForScope(scope, "completed")
            hasFinalizedScopeTools = true
          }
          this.upsertTranscriptTextMessage({
            kind: block.kind,
            uuid: this.resolveTranscriptBlockUuid(msg.uuid, block, ctx),
            text: block.text,
            isStreaming: false,
            timestamp,
            scope,
          })
          break
        case "tool_call":
          this.upsertToolCallMessage(block.toolCall, scope, timestamp)
          break
      }
    }

    this.finalizeStreamingBlocksForMessage(msg.uuid, ctx.streamingBlocks)
  }

  private handleUserMessage(msg: Extract<SDKMessage, { readonly type: "user" }>): void {
    const toolResultIds = extractToolResultIds(msg.message)
    if (toolResultIds.length === 0) {
      return
    }

    for (const [index, toolUseId] of toolResultIds.entries()) {
      const toolCallMessage = this.getToolCallMessage(toolUseId)
      if (!toolCallMessage) {
        continue
      }

      const fileChange = normalizeFileToolResult(
        toolCallMessage.toolCall.name,
        pickIndexedToolUseResult(msg.tool_use_result, index),
      )

      if (!fileChange) {
        continue
      }

      this.updateToolCallById(toolUseId, (toolCall) => ({
        ...toolCall,
        status: "completed",
        fileChange,
      }))
    }
  }

  private handleStreamEventMessage(
    msg: Extract<SDKMessage, { readonly type: "stream_event" }>,
    ctx: SDKMessageContext,
  ): void {
    const timestamp = new Date()
    const scope = this.resolveMessageScope(msg.parent_tool_use_id)

    switch (msg.event.type) {
      case "content_block_start": {
        const contentBlock = msg.event.content_block

        switch (contentBlock.type) {
          case "text":
            this.startStreamingTranscriptBlock(
              msg.uuid,
              msg.event.index,
              "assistant",
              contentBlock.text,
              scope,
              timestamp,
              ctx,
            )
            break
          case "thinking":
            this.startStreamingTranscriptBlock(
              msg.uuid,
              msg.event.index,
              "thinking",
              contentBlock.thinking,
              scope,
              timestamp,
              ctx,
            )
            break
          case "tool_use":
          case "server_tool_use":
            this.upsertToolCallMessage(
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
        switch (msg.event.delta.type) {
          case "text_delta":
            this.appendStreamingTranscriptDelta(
              msg.uuid,
              msg.event.index,
              "assistant",
              msg.event.delta.text,
              scope,
              timestamp,
              ctx,
            )
            break
          case "thinking_delta":
            this.appendStreamingTranscriptDelta(
              msg.uuid,
              msg.event.index,
              "thinking",
              msg.event.delta.thinking,
              scope,
              timestamp,
              ctx,
            )
            break
          default:
            break
        }
        break
      }

      case "content_block_stop":
        this.stopStreamingTranscriptBlock(msg.uuid, msg.event.index, ctx.streamingBlocks)
        break

      default:
        break
    }
  }

  private handleToolProgressMessage(
    msg: Extract<SDKMessage, { readonly type: "tool_progress" }>,
  ): void {
    this.upsertToolCallMessage(
      {
        id: msg.tool_use_id,
        name: msg.tool_name,
        input: {},
        status: "running",
        output: null,
        elapsedSeconds: msg.elapsed_time_seconds,
      },
      this.resolveMessageScope(msg.parent_tool_use_id, msg.task_id ?? null),
      new Date(),
    )
  }

  private handleToolUseSummaryMessage(
    msg: Extract<SDKMessage, { readonly type: "tool_use_summary" }>,
  ): void {
    for (const toolUseId of msg.preceding_tool_use_ids) {
      this.updateToolCallById(toolUseId, (toolCall) => ({
        ...toolCall,
        status: "completed",
        output: msg.summary,
      }))
    }
  }

  private startStreamingTranscriptBlock(
    messageUuid: string,
    blockIndex: number,
    kind: StreamingBlockKind,
    initialText: string,
    scope: MessageScope,
    timestamp: Date,
    ctx: SDKMessageContext,
  ): void {
    const key = getStreamingBlockKey(messageUuid, blockIndex)
    const existing = ctx.streamingBlocks.get(key)
    if (!existing) {
      this.finalizeRunningToolCallsForScope(scope, "completed")
    }
    const reusableMessage = existing ? null : this.getLatestReusableTranscriptTextMessage(kind, scope)
    const rowUuid =
      existing?.rowUuid ?? reusableMessage?.uuid ?? transcriptMessageUuid(kind, messageUuid, blockIndex)
    const nextText = `${existing?.text ?? reusableMessage?.text ?? ""}${initialText}`

    ctx.streamingBlocks.set(key, {
      rowUuid,
      kind,
      text: nextText,
    })

    if (nextText.length > 0) {
      this.upsertTranscriptTextMessage({
        kind,
        uuid: rowUuid,
        text: nextText,
        isStreaming: true,
        timestamp,
        scope,
      })
    }
  }

  private appendStreamingTranscriptDelta(
    messageUuid: string,
    blockIndex: number,
    kind: StreamingBlockKind,
    deltaText: string,
    scope: MessageScope,
    timestamp: Date,
    ctx: SDKMessageContext,
  ): void {
    const key = getStreamingBlockKey(messageUuid, blockIndex)
    const existing = ctx.streamingBlocks.get(key)
    if (!existing) {
      this.finalizeRunningToolCallsForScope(scope, "completed")
    }
    const reusableMessage = existing ? null : this.getLatestReusableTranscriptTextMessage(kind, scope)
    const rowUuid =
      existing?.rowUuid ?? reusableMessage?.uuid ?? transcriptMessageUuid(kind, messageUuid, blockIndex)
    const nextText = `${existing?.text ?? reusableMessage?.text ?? ""}${deltaText}`

    ctx.streamingBlocks.set(key, {
      rowUuid,
      kind,
      text: nextText,
    })

    if (nextText.length > 0) {
      this.upsertTranscriptTextMessage({
        kind,
        uuid: rowUuid,
        text: nextText,
        isStreaming: true,
        timestamp,
        scope,
      })
    }
  }

  private stopStreamingTranscriptBlock(
    messageUuid: string,
    blockIndex: number,
    streamingBlocks: Map<string, StreamingBlockState>,
  ): void {
    const key = getStreamingBlockKey(messageUuid, blockIndex)
    const existing = streamingBlocks.get(key)
    if (!existing) {
      return
    }

    const message = this.getTranscriptTextMessage(existing.rowUuid)
    if (message?.isStreaming) {
      this.dispatch({
        type: "set_message_streaming",
        uuid: existing.rowUuid,
        isStreaming: false,
      })
    }

  }

  private finalizeStreamingBlocksForMessage(
    messageUuid: string,
    streamingBlocks: Map<string, StreamingBlockState>,
  ): void {
    for (const [key, block] of streamingBlocks.entries()) {
      if (!key.startsWith(`${messageUuid}:`)) {
        continue
      }

      const message = this.getTranscriptTextMessage(block.rowUuid)
      if (message?.isStreaming) {
        this.dispatch({
          type: "set_message_streaming",
          uuid: block.rowUuid,
          isStreaming: false,
        })
      }

      streamingBlocks.delete(key)
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
      this.dispatch({
        type: "set_message_streaming",
        uuid: options.uuid,
        isStreaming: options.isStreaming,
      })
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

  private resolveTranscriptBlockUuid(
    messageUuid: string,
    block: Extract<AssistantBlock, { readonly kind: "assistant" | "thinking" }>,
    ctx: SDKMessageContext,
  ): MessageUUID {
    for (const index of block.sourceIndices) {
      const existing = ctx.streamingBlocks.get(getStreamingBlockKey(messageUuid, index))
      if (existing) {
        return existing.rowUuid
      }
    }

    return block.uuid
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

  private getLatestReusableTranscriptTextMessage(
    kind: StreamingBlockKind,
    scope: MessageScope,
  ): AssistantDisplayMessage | ThinkingDisplayMessage | null {
    const lastMessage = this.state.messages.at(-1)

    if (
      lastMessage &&
      (lastMessage.kind === "assistant" || lastMessage.kind === "thinking") &&
      lastMessage.kind === kind &&
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

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

type AssistantBlock =
  | {
      readonly kind: "assistant"
      readonly uuid: MessageUUID
      readonly text: string
      readonly sourceIndices: readonly number[]
    }
  | {
      readonly kind: "thinking"
      readonly uuid: MessageUUID
      readonly text: string
      readonly sourceIndices: readonly number[]
    }
  | {
      readonly kind: "tool_call"
      readonly uuid: MessageUUID
      readonly toolCall: ToolCall
    }

function projectSessionHistory(history: readonly unknown[]): readonly DisplayMessage[] {
  let state = initialConversationState

  for (const message of history) {
    state = projectSessionMessage(state, message)
  }

  return state.messages
}

function projectSessionMessage(
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

  for (const block of extractAssistantBlocks(messageUuid, message["message"], {
    defaultToolStatus: "completed",
  })) {
    switch (block.kind) {
      case "assistant": {
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
      }
      case "thinking": {
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
      }
      case "tool_call": {
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
  }

  return nextState
}

function projectHistoryToolResultMessage(
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

    const fileChange = normalizeFileToolResult(
      toolCallMessage.toolCall.name,
      pickIndexedToolUseResult(message["tool_use_result"], index),
    )

    if (!fileChange) {
      continue
    }

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

  return nextState
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

function pickIndexedToolUseResult(toolUseResult: unknown, index: number): unknown {
  if (!Array.isArray(toolUseResult)) {
    return toolUseResult
  }

  if (toolUseResult.length === 1) {
    return toolUseResult[0]
  }

  return toolUseResult[index]
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function extractAssistantBlocks(
  messageUuid: string,
  message: unknown,
  options: { readonly defaultToolStatus: ToolCall["status"] },
): readonly AssistantBlock[] {
  if (!isRecord(message)) {
    return []
  }

  const content = message["content"]

  if (typeof content === "string") {
    return content.length > 0
      ? [
          {
            kind: "assistant",
            uuid: transcriptMessageUuid("assistant", messageUuid, 0),
            text: content,
            sourceIndices: [0],
          },
        ]
      : []
  }

  if (!Array.isArray(content)) {
    return []
  }

  const blocks: AssistantBlock[] = []

  const appendTextBlock = (
    kind: Extract<AssistantBlock, { readonly kind: "assistant" | "thinking" }>['kind'],
    text: string,
    index: number,
  ) => {
    if (text.length === 0) {
      return
    }

    const previous = blocks.at(-1)
    if (previous && previous.kind === kind) {
      blocks[blocks.length - 1] = {
        ...previous,
        text: `${previous.text}${text}`,
        sourceIndices: [...previous.sourceIndices, index],
      }
      return
    }

    blocks.push({
      kind,
      uuid: transcriptMessageUuid(kind, messageUuid, index),
      text,
      sourceIndices: [index],
    })
  }

  for (const [index, block] of content.entries()) {
    if (typeof block === "string") {
      appendTextBlock("assistant", block, index)
      continue
    }

    if (!isRecord(block)) {
      continue
    }

    const type = block["type"]

    if (type === "text" && typeof block["text"] === "string" && block["text"].length > 0) {
      appendTextBlock("assistant", block["text"], index)
      continue
    }

    if (
      type === "thinking" &&
      typeof block["thinking"] === "string" &&
      block["thinking"].length > 0
    ) {
      appendTextBlock("thinking", block["thinking"], index)
      continue
    }

    if (
      (type === "tool_use" || type === "server_tool_use") &&
      typeof block["id"] === "string" &&
      typeof block["name"] === "string"
    ) {
      blocks.push({
        kind: "tool_call",
        uuid: toolCallMessageUuid(block["id"]),
        toolCall: {
          id: block["id"],
          name: block["name"],
          input: isRecord(block["input"]) ? block["input"] : {},
          status: options.defaultToolStatus,
          output: null,
          elapsedSeconds: null,
        },
      })
    }
  }

  return blocks
}

function extractTextContent(message: unknown): string {
  if (!isRecord(message)) {
    return ""
  }

  const content = message["content"]
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .flatMap((block) => {
      if (typeof block === "string") {
        return [block]
      }

      if (isRecord(block) && typeof block["text"] === "string") {
        return [block["text"]]
      }

      return []
    })
    .join("")
}

function transcriptMessageUuid(
  kind: StreamingBlockKind,
  messageUuid: string,
  blockIndex: number,
): MessageUUID {
  return MessageUUID(`${kind}:${messageUuid}:${blockIndex}`)
}

function toolCallMessageUuid(toolUseId: string): MessageUUID {
  return MessageUUID(`tool:${toolUseId}`)
}

function getStreamingBlockKey(messageUuid: string, blockIndex: number): string {
  return `${messageUuid}:${blockIndex}`
}

function mergeTaskStarted(
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

function mergeTaskProgress(
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

function mergeTaskNotification(
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

function taskUsageFromSDK(
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

function isFinalTaskStatus(status: SpawnedTask["status"]): boolean {
  return status === "completed" || status === "failed" || status === "stopped"
}

function normalizeTaskDescription(
  description: string,
  current: SpawnedTask | null,
): string {
  return normalizeOptionalTaskText(description) ?? current?.description ?? "Background task"
}

function normalizeOptionalTaskText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
