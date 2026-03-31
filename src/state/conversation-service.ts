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
} from "#sdk/types"
import { MessageUUID, SessionId, sessionSummaryFromSDK } from "#sdk/types"
import type { SessionSummary } from "#sdk/types"
import {
  type ConversationState,
  type ConversationAction,
  type DisplayMessage,
  type TaskDisplayMessage,
  type StartupState,
  type StartupTaskState,
  conversationReducer,
  initialConversationState,
} from "#state/types"
import type { AppConfig } from "#config/schema"
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
        showThinking: config.showThinking,
        diffMode: config.diffMode,
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
      const historyMessages = history
        .map((message) => displayMessageFromSessionMessage(message))
        .filter((message): message is DisplayMessage => message !== null)

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
    this.dispatch({ type: "set_permission_mode", mode })
    if (this.activeQuery) {
      await this.activeQuery.setPermissionMode(mode as never)
    }
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
    let currentAssistantUuid: string | null = null
    let streamingContent = ""
    let resumedPriorText = ""

    try {
      // Fetch available models and commands from the query
      this.fetchQueryMetadata(q)

      for await (const msg of q) {
        this.handleSDKMessage(msg, {
          getCurrentAssistantUuid: () => currentAssistantUuid,
          setCurrentAssistantUuid: (uuid: string | null) => {
            currentAssistantUuid = uuid
          },
          getStreamingContent: () => streamingContent,
          setStreamingContent: (content: string) => {
            streamingContent = content
          },
          getResumedPriorText: () => resumedPriorText,
          setResumedPriorText: (text: string) => {
            resumedPriorText = text
          },
        })
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
    ctx: {
      getCurrentAssistantUuid: () => string | null
      setCurrentAssistantUuid: (uuid: string | null) => void
      getStreamingContent: () => string
      setStreamingContent: (content: string) => void
      getResumedPriorText: () => string
      setResumedPriorText: (text: string) => void
    },
  ): void {
    switch (msg.type) {
      case "assistant": {
        const text = extractTextFromMessage(msg.message)
        const streamingMessage = this.getLatestStreamingAssistantMessage()
        const extractedToolCalls = extractToolCallsFromAssistantMessage(msg.message)

        if (streamingMessage) {
          // If this message was resumed from a prior turn, prepend the
          // prior turn's text so it isn't lost during finalization.
          const priorText = ctx.getResumedPriorText()
          const finalText = priorText && text
            ? priorText + "\n\n" + text
            : text || priorText
          const toolCalls = finalizeToolCalls(
            mergeToolCalls(streamingMessage.toolCalls, extractedToolCalls),
          )
          this.dispatch({
            type: "finalize_assistant_message",
            uuid: streamingMessage.uuid,
            text: finalText,
            toolCalls,
          })
        } else {
          // Check if the last message is a non-streaming assistant message
          // from the same turn (no user message in between). If so, merge
          // into it to avoid duplicate assistant bubbles when the SDK sends
          // a tool-only message followed by a text-only message.
          const lastMsg = this.state.messages.at(-1)
          if (lastMsg?.kind === "assistant" && !lastMsg.isStreaming) {
            const mergedText = lastMsg.text && text
              ? lastMsg.text + "\n\n" + text
              : text || lastMsg.text
            const mergedToolCalls = finalizeToolCalls(
              mergeToolCalls(lastMsg.toolCalls, extractedToolCalls),
            )
            this.dispatch({
              type: "finalize_assistant_message",
              uuid: lastMsg.uuid,
              text: mergedText,
              toolCalls: mergedToolCalls,
            })
          } else {
            const uuid = MessageUUID(msg.uuid)
            this.dispatch({
              type: "append_message",
              message: {
                kind: "assistant",
                uuid,
                text,
                toolCalls: finalizeToolCalls(extractedToolCalls),
                isStreaming: false,
                timestamp: new Date(),
              },
            })
          }
        }
        ctx.setCurrentAssistantUuid(null)
        ctx.setStreamingContent("")
        ctx.setResumedPriorText("")
        break
      }

      case "stream_event": {
        const event = msg.event
        if (event.type === "content_block_delta" && "delta" in event) {
          const delta = event.delta as unknown as Record<string, unknown>
          if ("text" in delta && typeof delta["text"] === "string") {
            const deltaText = delta["text"] as string

            if (!ctx.getCurrentAssistantUuid()) {
              // Check if the last message is a finalized assistant from the
              // same turn. If so, resume streaming on it instead of creating
              // a duplicate message.
              const lastMsg = this.state.messages.at(-1)
              if (lastMsg?.kind === "assistant" && !lastMsg.isStreaming) {
                ctx.setCurrentAssistantUuid(lastMsg.uuid)
                ctx.setResumedPriorText(lastMsg.text)
                // Pre-seed streaming content with existing text so the UI
                // shows the full accumulated text during streaming.
                const prefix = lastMsg.text ? lastMsg.text + "\n\n" : ""
                ctx.setStreamingContent(prefix)
                this.dispatch({
                  type: "set_message_streaming",
                  uuid: lastMsg.uuid,
                  isStreaming: true,
                })
              } else {
                const uuid = msg.uuid
                ctx.setCurrentAssistantUuid(uuid)
                this.dispatch({
                  type: "append_message",
                  message: {
                    kind: "assistant",
                    uuid: MessageUUID(uuid),
                    text: deltaText,
                    toolCalls: [],
                    isStreaming: true,
                    timestamp: new Date(),
                  },
                })
              }
            }

            const newContent = ctx.getStreamingContent() + deltaText
            ctx.setStreamingContent(newContent)
            this.dispatch({ type: "update_streaming_text", text: newContent })
          }
        }
        break
      }

      case "result": {
        if (msg.subtype === "success") {
          this.dispatch({
            type: "update_cost",
            costUsd: msg.total_cost_usd,
            tokens: msg.usage.input_tokens + msg.usage.output_tokens,
          })
          if (msg.session_id) {
            this.dispatch({
              type: "set_session",
              sessionId: SessionId(msg.session_id),
            })
          }
        } else {
          const errors = "errors" in msg ? (msg as any).errors : []
          this.appendErrorMessage(
            Array.isArray(errors) ? errors.join("\n") : "Query failed",
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
        const assistantUuid = ctx.getCurrentAssistantUuid()
        if (assistantUuid) {
          this.dispatch({
            type: "update_tool_call",
            messageUuid: MessageUUID(assistantUuid),
            toolCall: {
              id: msg.tool_use_id,
              name: msg.tool_name,
              input: {},
              status: "running",
              output: null,
              elapsedSeconds: msg.elapsed_time_seconds,
            },
          })
        }
        break
      }

      case "tool_use_summary": {
        for (const toolUseId of msg.preceding_tool_use_ids) {
          this.updateToolCallById(toolUseId, (toolCall) => ({
            ...toolCall,
            status: "completed",
            output: msg.summary,
          }))
        }
        break
      }

      default:
        break
    }
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

  private getQueryOptions(canUseTool: CanUseTool): Partial<Options> {
    return {
      canUseTool,
      model: this.state.model,
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

  private getLatestStreamingAssistantMessage() {
    for (let index = this.state.messages.length - 1; index >= 0; index -= 1) {
      const message = this.state.messages[index]
      if (message?.kind === "assistant" && message.isStreaming) {
        return message
      }
    }

    return null
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
  ): void {
    const existing = this.getTaskMessage(taskId)

    this.dispatch({
      type: "upsert_task_message",
      task: updater(existing?.task ?? null),
      timestamp: existing?.timestamp ?? new Date(),
    })
  }

  private handleTaskStartedMessage(message: SDKTaskStartedMessage): void {
    this.upsertTaskMessage(message.task_id, (current) => mergeTaskStarted(current, message))
  }

  private handleTaskProgressMessage(message: SDKTaskProgressMessage): void {
    this.upsertTaskMessage(message.task_id, (current) => mergeTaskProgress(current, message))
  }

  private handleTaskNotificationMessage(message: SDKTaskNotificationMessage): void {
    this.upsertTaskMessage(message.task_id, (current) => mergeTaskNotification(current, message))
  }

  private updateToolCallById(
    toolCallId: string,
    updater: (toolCall: ToolCall) => ToolCall,
  ) {
    for (const message of this.state.messages) {
      if (message.kind !== "assistant") continue

      const toolCall = message.toolCalls.find((candidate) => candidate.id === toolCallId)
      if (!toolCall) continue

      this.dispatch({
        type: "update_tool_call",
        messageUuid: message.uuid,
        toolCall: updater(toolCall),
      })
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function extractTextFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return ""
  const msg = message as Record<string, unknown>
  const content = msg["content"]
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((block: unknown) => {
        if (typeof block === "string") return block
        if (block && typeof block === "object" && "text" in block) {
          return String((block as Record<string, unknown>)["text"])
        }
        return ""
      })
      .join("")
  }
  return ""
}

function displayMessageFromSessionMessage(message: unknown): DisplayMessage | null {
  if (!message || typeof message !== "object") return null

  const raw = message as Record<string, unknown>
  const type = raw["type"]
  const uuid = typeof raw["uuid"] === "string" ? raw["uuid"] : crypto.randomUUID()
  const content = extractTextFromMessage(raw["message"])

  if (type === "user") {
    return {
      kind: "user",
      uuid: MessageUUID(uuid),
      text: content,
      timestamp: new Date(),
    }
  }

  if (type === "assistant") {
    return {
      kind: "assistant",
      uuid: MessageUUID(uuid),
      text: content,
      toolCalls: [],
      isStreaming: false,
      timestamp: new Date(),
    }
  }

  return null
}

function extractToolCallsFromAssistantMessage(message: unknown) {
  if (!message || typeof message !== "object") return []

  const raw = message as Record<string, unknown>
  const content = raw["content"]
  if (!Array.isArray(content)) return []

  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return []

    const candidate = block as Record<string, unknown>
    const type = candidate["type"]
    const id = candidate["id"]
    const name = candidate["name"]
    const input = candidate["input"]

    if (
      (type === "tool_use" || type === "server_tool_use") &&
      typeof id === "string" &&
      typeof name === "string"
    ) {
      return [
        {
          id,
          name,
          input: isRecord(input) ? input : {},
          status: "completed" as const,
          output: null,
          elapsedSeconds: null,
        },
      ]
    }

    return []
  })
}

function mergeToolCalls(existing: readonly ToolCall[], incoming: readonly ToolCall[]): ToolCall[] {
  const merged = new Map(existing.map((toolCall) => [toolCall.id, toolCall]))

  for (const toolCall of incoming) {
    const current = merged.get(toolCall.id)
    merged.set(toolCall.id, {
      ...current,
      ...toolCall,
      output: toolCall.output ?? current?.output ?? null,
      elapsedSeconds: toolCall.elapsedSeconds ?? current?.elapsedSeconds ?? null,
      input: Object.keys(toolCall.input).length > 0 ? toolCall.input : current?.input ?? {},
    })
  }

  return [...merged.values()]
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

function finalizeToolCalls(toolCalls: readonly ToolCall[]): ToolCall[] {
  return toolCalls.map((toolCall) => ({
    ...toolCall,
    status: toolCall.status === "error" ? "error" : "completed" as const,
  }))
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
