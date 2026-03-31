import { describe, expect, it } from "bun:test"
import { MessageUUID, SessionId, type Query } from "#sdk/types"
import { ConversationService } from "#state/conversation-service"
import type { AppConfig } from "#config/schema"
import type { DisplayMessage, TaskDisplayMessage } from "#state/types"

const TEST_CONFIG: AppConfig = {
  theme: "dark",
  editor: "$EDITOR",
  defaultModel: "sonnet",
  defaultPermissionMode: "default",
  keybindings: {},
  diffMode: "unified",
  claudePath: "claude",
}

describe("ConversationService", () => {
  it("tracks startup auth state separately from conversation state", () => {
    const service = new ConversationService(TEST_CONFIG, undefined, {
      createQuery: () => createFakeQuery(),
      getQueryMetadata: async () => createEmptyMetadata(),
      getSessionMessages: async () => [],
      listSessions: async () => [],
      loadSupportedMetadata: async () => createEmptyMetadata(),
      resumeSession: () => createFakeQuery(),
    })

    service.beginStartup({ resumeSessionId: "session-1" })

    expect(service.getState().startup).toEqual({
      auth: { status: "loading" },
      resume: { status: "loading" },
      metadata: { status: "idle" },
    })

    service.markAuthReady()
    expect(service.getState().startup.auth).toEqual({ status: "ready" })

    service.markAuthFailed("auth missing")
    expect(service.getState().startup.auth).toEqual({
      status: "failed",
      message: "auth missing",
    })
    expect(service.getState().startup.resume).toEqual({ status: "idle" })
  })

  it("uses the selected runtime model for new and resumed queries", async () => {
    const createQueryCalls: Array<{ readonly model: string | undefined }> = []
    const resumeSessionCalls: Array<{ readonly model: string | undefined }> = []
    const service = new ConversationService(
      TEST_CONFIG,
      undefined,
      {
        createQuery: (_config, params) => {
          createQueryCalls.push({ model: params.options?.model })
          return createFakeQuery()
        },
        getQueryMetadata: async () => createEmptyMetadata(),
        getSessionMessages: async () => [],
        listSessions: async () => [],
        loadSupportedMetadata: async () => createEmptyMetadata(),
        resumeSession: (_config, _sessionId, _prompt, overrides) => {
          resumeSessionCalls.push({ model: overrides?.model })
          return createFakeQuery()
        },
      },
    )

    await service.setModel("haiku")
    service.setPromptText("hello")
    await service.submitCurrentPrompt()

    expect(createQueryCalls).toEqual([{ model: "haiku" }])

    await service.loadSession("session-1")

    expect(resumeSessionCalls).toEqual([{ model: "haiku" }])
  })

  it("loads session history and allows follow-up prompts in the resumed session", async () => {
    let createQueryCallCount = 0
    let resumedPromptCount = 0
    const service = new ConversationService(
      TEST_CONFIG,
      undefined,
      {
        createQuery: () => {
          createQueryCallCount += 1
          return createFakeQuery()
        },
        getQueryMetadata: async () => createEmptyMetadata(),
        getSessionMessages: async () => [
          { type: "user", uuid: "user-1", message: { content: "Earlier prompt" } },
          { type: "assistant", uuid: "assistant-1", message: { content: "Earlier answer" } },
        ],
        listSessions: async () => [],
        loadSupportedMetadata: async () => createEmptyMetadata(),
        resumeSession: (_config, _sessionId, prompt) => {
          void consumePrompt(prompt, () => {
            resumedPromptCount += 1
          })
          return createFakeQuery()
        },
      },
    )

    await service.loadSession("session-1")

    expect(service.getState().sessionId).toBe(SessionId("session-1"))
    expect(service.getState().messages.map((message) => `${message.kind}:${getMessageText(message)}`)).toEqual([
      "user:Earlier prompt",
      "assistant:Earlier answer",
    ])

    service.setPromptText("Continue from here")
    await service.submitCurrentPrompt()
    await Bun.sleep(0)

    expect(createQueryCallCount).toBe(0)
    expect(resumedPromptCount).toBe(1)
    expect(service.getState().messages.at(-1)?.kind).toBe("user")
    expect(getMessageText(service.getState().messages.at(-1))).toBe("Continue from here")
  })

  it("exposes loading and ready states for metadata preload and session resume", async () => {
    const history = deferred<readonly unknown[]>()
    const metadata = deferred<ReturnType<typeof createEmptyMetadata>>()
    const service = new ConversationService(TEST_CONFIG, undefined, {
      createQuery: () => createFakeQuery(),
      getQueryMetadata: async () => createEmptyMetadata(),
      getSessionMessages: async () => history.promise,
      listSessions: async () => [],
      loadSupportedMetadata: async () => metadata.promise,
      resumeSession: () => createFakeQuery(),
    })

    const metadataPromise = service.loadSupportedMetadata()
    expect(service.getState().startup.metadata).toEqual({ status: "loading" })

    metadata.resolve(createEmptyMetadata())
    await metadataPromise
    expect(service.getState().startup.metadata).toEqual({ status: "ready" })

    const resumePromise = service.startResumeSession("session-1")
    expect(service.getState().startup.resume).toEqual({ status: "loading" })

    history.resolve([
      { type: "user", uuid: "user-1", message: { content: "Earlier prompt" } },
      { type: "assistant", uuid: "assistant-1", message: { content: "Earlier answer" } },
    ])
    await resumePromise

    expect(service.getState().startup.resume).toEqual({ status: "ready" })
  })

  it("does not update model state until the active query accepts it", async () => {
    const query = createFakeQuery({
      setModel: async () => {
        throw new Error("model rejected")
      },
    })
    const service = new ConversationService(
      TEST_CONFIG,
      undefined,
      {
        createQuery: () => query,
        getQueryMetadata: async () => createEmptyMetadata(),
        getSessionMessages: async () => [],
        listSessions: async () => [],
        loadSupportedMetadata: async () => createEmptyMetadata(),
        resumeSession: () => query,
      },
    )

    service.setPromptText("hello")
    await service.submitCurrentPrompt()

    await expect(service.setModel("opus")).rejects.toThrow("model rejected")
    expect(service.getState().model).toBe("sonnet")
  })

  it("merges consecutive assistant messages into a single message", async () => {
    // When the SDK sends a tool-only assistant message followed by a text
    // assistant message (same turn, no user message in between), they should
    // be merged into a single DisplayMessage to avoid duplicate bubbles.
    const sdkMessages = [
      {
        type: "assistant",
        uuid: "assistant-tools",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "/src/index.ts" },
            },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "assistant-text",
        message: {
          content: "Here is the answer.",
        },
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "session-1",
      },
    ]

    const query = createFakeQuery({
      messages: sdkMessages,
    })

    const service = new ConversationService(
      TEST_CONFIG,
      undefined,
      {
        createQuery: () => query,
        getQueryMetadata: async () => createEmptyMetadata(),
        getSessionMessages: async () => [],
        listSessions: async () => [],
        loadSupportedMetadata: async () => createEmptyMetadata(),
        resumeSession: () => query,
      },
    )

    service.setPromptText("Explain this codebase")
    await service.submitCurrentPrompt()
    // Allow async iterator to complete
    await Bun.sleep(10)

    const messages = service.getState().messages
    const assistantMessages = messages.filter((m) => m.kind === "assistant")

    // Should be merged into ONE assistant message, not two
    expect(assistantMessages.length).toBe(1)

    const merged = assistantMessages[0]!
    expect(merged.text).toBe("Here is the answer.")
    expect(merged.kind === "assistant" && merged.toolCalls.length).toBe(1)
    expect(merged.kind === "assistant" && merged.toolCalls[0]!.name).toBe("Read")
  })

  it("merges streamed assistant turns separated by tool use into a single message", async () => {
    // Simulates the full streaming flow:
    // 1. stream_event deltas (round 1 text)
    // 2. assistant final (round 1: text + tool_use)
    // 3. stream_event deltas (round 2 text)
    // 4. assistant final (round 2: text only)
    // Should produce ONE merged assistant message, not two.
    const sdkMessages = [
      // Round 1: streaming deltas
      {
        type: "stream_event",
        uuid: "msg-1",
        event: {
          type: "content_block_delta",
          delta: { text: "Let me check " },
        },
      },
      {
        type: "stream_event",
        uuid: "msg-1",
        event: {
          type: "content_block_delta",
          delta: { text: "that file." },
        },
      },
      // Round 1: assistant final with tool_use
      {
        type: "assistant",
        uuid: "msg-1",
        message: {
          content: [
            { type: "text", text: "Let me check that file." },
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "/src/index.ts" },
            },
          ],
        },
      },
      // Round 2: streaming deltas (new turn after tool execution)
      {
        type: "stream_event",
        uuid: "msg-2",
        event: {
          type: "content_block_delta",
          delta: { text: "Here is " },
        },
      },
      {
        type: "stream_event",
        uuid: "msg-2",
        event: {
          type: "content_block_delta",
          delta: { text: "the answer." },
        },
      },
      // Round 2: assistant final
      {
        type: "assistant",
        uuid: "msg-2",
        message: {
          content: "Here is the answer.",
        },
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.02,
        usage: { input_tokens: 200, output_tokens: 100 },
        session_id: "session-1",
      },
    ]

    const query = createFakeQuery({ messages: sdkMessages })

    const service = new ConversationService(
      TEST_CONFIG,
      undefined,
      {
        createQuery: () => query,
        getQueryMetadata: async () => createEmptyMetadata(),
        getSessionMessages: async () => [],
        listSessions: async () => [],
        loadSupportedMetadata: async () => createEmptyMetadata(),
        resumeSession: () => query,
      },
    )

    service.setPromptText("Explain this")
    await service.submitCurrentPrompt()
    await Bun.sleep(10)

    const messages = service.getState().messages
    const assistantMessages = messages.filter((m) => m.kind === "assistant")

    // Should be ONE merged assistant message
    expect(assistantMessages.length).toBe(1)

    const merged = assistantMessages[0]!
    // Text from both rounds, concatenated
    expect(merged.text).toBe("Let me check that file.\n\nHere is the answer.")
    // Tool calls from round 1 preserved
    expect(merged.kind === "assistant" && merged.toolCalls.length).toBe(1)
    expect(merged.kind === "assistant" && merged.toolCalls[0]!.name).toBe("Read")
  })

  it("projects task lifecycle events into one stable task row", async () => {
    const service = await runServiceWithMessages([
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        description: "Inspect slash command flow",
        task_type: "local_agent",
        prompt: "Inspect slash command flow",
        uuid: "task-start-1",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_progress",
        task_id: "task-1",
        description: "Inspect slash command flow",
        usage: {
          total_tokens: 320,
          tool_uses: 2,
          duration_ms: 3200,
        },
        last_tool_name: "Grep",
        summary: "Searching command and picker modules",
        uuid: "task-progress-1",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "completed",
        output_file: "/tmp/task-1.md",
        summary: "Found the slash command entry points",
        usage: {
          total_tokens: 640,
          tool_uses: 4,
          duration_ms: 12_000,
        },
        uuid: "task-finish-1",
        session_id: "session-1",
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "session-1",
      },
    ])

    const taskMessages = getTaskMessages(service)

    expect(taskMessages).toHaveLength(1)
    expect(taskMessages[0]).toMatchObject({
      kind: "task",
      uuid: MessageUUID("task:task-1"),
      task: {
        id: "task-1",
        description: "Inspect slash command flow",
        taskType: "local_agent",
        workflowName: null,
        toolUseId: null,
        prompt: "Inspect slash command flow",
        status: "completed",
        summary: "Found the slash command entry points",
        lastToolName: "Grep",
        outputFile: "/tmp/task-1.md",
        usage: {
          totalTokens: 640,
          toolUses: 4,
          durationMs: 12000,
        },
      },
    })
  })

  it("keeps concurrent spawned tasks isolated by task_id", async () => {
    const service = await runServiceWithMessages([
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        description: "Inspect slash commands",
        task_type: "local_agent",
        uuid: "task-start-1",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-2",
        description: "Run workflow spec",
        task_type: "local_workflow",
        workflow_name: "spec",
        uuid: "task-start-2",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_progress",
        task_id: "task-1",
        description: "Inspect slash commands",
        usage: {
          total_tokens: 210,
          tool_uses: 1,
          duration_ms: 1800,
        },
        summary: "Reading command registry",
        uuid: "task-progress-1",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_notification",
        task_id: "task-2",
        status: "failed",
        output_file: "/tmp/task-2.md",
        summary: "Workflow validation failed",
        uuid: "task-finish-2",
        session_id: "session-1",
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "session-1",
      },
    ])

    const taskMessages = getTaskMessages(service)

    expect(taskMessages).toHaveLength(2)
    expect(taskMessages.map((message) => message.task.id)).toEqual(["task-1", "task-2"])
    expect(taskMessages[0]?.task.status).toBe("running")
    expect(taskMessages[0]?.task.summary).toBe("Reading command registry")
    expect(taskMessages[1]?.task.status).toBe("failed")
    expect(taskMessages[1]?.task.workflowName).toBe("spec")
    expect(taskMessages[1]?.task.summary).toBe("Workflow validation failed")
  })

  it("creates a visible running task when progress arrives before started", async () => {
    const service = await runServiceWithMessages([
      {
        type: "system",
        subtype: "task_progress",
        task_id: "task-1",
        description: "Inspect message rendering",
        tool_use_id: "tool-1",
        usage: {
          total_tokens: 200,
          tool_uses: 1,
          duration_ms: 900,
        },
        last_tool_name: "Read",
        summary: "Checking MessageArea and layout helpers",
        uuid: "task-progress-1",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        description: "Inspect message rendering",
        task_type: "local_agent",
        prompt: "Inspect message rendering",
        uuid: "task-start-1",
        session_id: "session-1",
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "session-1",
      },
    ])

    const taskMessages = getTaskMessages(service)

    expect(taskMessages).toHaveLength(1)
    expect(taskMessages[0]).toMatchObject({
      task: {
        id: "task-1",
        description: "Inspect message rendering",
        taskType: "local_agent",
        toolUseId: "tool-1",
        prompt: "Inspect message rendering",
        status: "running",
        summary: "Checking MessageArea and layout helpers",
        lastToolName: "Read",
        usage: {
          totalTokens: 200,
          toolUses: 1,
          durationMs: 900,
        },
      },
    })
  })

  it("maps completed, failed, and stopped task notifications to final task states", async () => {
    const service = await runServiceWithMessages([
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-completed",
        description: "Completed task",
        uuid: "task-start-1",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-failed",
        description: "Failed task",
        uuid: "task-start-2",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-stopped",
        description: "Stopped task",
        uuid: "task-start-3",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_notification",
        task_id: "task-completed",
        status: "completed",
        output_file: "/tmp/task-completed.md",
        summary: "done",
        uuid: "task-finish-1",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_notification",
        task_id: "task-failed",
        status: "failed",
        output_file: "/tmp/task-failed.md",
        summary: "failed",
        uuid: "task-finish-2",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_notification",
        task_id: "task-stopped",
        status: "stopped",
        output_file: "/tmp/task-stopped.md",
        summary: "stopped",
        uuid: "task-finish-3",
        session_id: "session-1",
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "session-1",
      },
    ])

    expect(getTaskMessages(service).map((message) => message.task.status)).toEqual([
      "completed",
      "failed",
      "stopped",
    ])
  })
})

function createEmptyMetadata() {
  return {
    commands: [],
    models: [],
    account: { email: "test@example.com" },
  }
}

async function runServiceWithMessages(messages: readonly unknown[]): Promise<ConversationService> {
  const query = createFakeQuery({ messages })
  const service = new ConversationService(
    TEST_CONFIG,
    undefined,
    {
      createQuery: () => query,
      getQueryMetadata: async () => createEmptyMetadata(),
      getSessionMessages: async () => [],
      listSessions: async () => [],
      loadSupportedMetadata: async () => createEmptyMetadata(),
      resumeSession: () => query,
    },
  )

  service.setPromptText("Run task projection test")
  await service.submitCurrentPrompt()
  await Bun.sleep(10)

  return service
}

function createFakeQuery(overrides?: {
  readonly setModel?: Query["setModel"]
  readonly messages?: readonly unknown[]
}): Query {
  return {
    close() {
      return
    },
    initializationResult: async () => ({
      commands: [],
      models: [],
      account: { email: "test@example.com" },
    }),
    interrupt: async () => {
      return
    },
    setModel: overrides?.setModel ?? (async () => {
      return
    }),
    setPermissionMode: async () => {
      return
    },
    async *[Symbol.asyncIterator]() {
      if (overrides?.messages) {
        for (const msg of overrides.messages) {
          yield msg
        }
      }
      return
    },
  } as unknown as Query
}

async function consumePrompt(
  prompt: AsyncIterable<unknown>,
  onMessage: () => void,
): Promise<void> {
  for await (const _message of prompt) {
    onMessage()
    break
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return {
    promise,
    resolve,
    reject,
  }
}

function getTaskMessages(service: ConversationService): TaskDisplayMessage[] {
  return service.getState().messages.filter(
    (message): message is TaskDisplayMessage => message.kind === "task",
  )
}

function getMessageText(message: DisplayMessage | undefined): string {
  if (!message) {
    return ""
  }

  switch (message.kind) {
    case "user":
    case "assistant":
    case "system":
    case "error":
      return message.text
    case "task":
      return message.task.description
  }
}
