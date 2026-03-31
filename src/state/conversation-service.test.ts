import { describe, expect, it } from "bun:test"
import { MessageUUID, SessionId, type Query } from "#sdk/types"
import { ConversationService } from "#state/conversation-service"
import type { AppConfig } from "#config/schema"
import type { DisplayMessage, TaskDisplayMessage, ToolCallDisplayMessage } from "#state/types"

const TEST_CONFIG: AppConfig = {
  theme: "dark",
  editor: "$EDITOR",
  defaultModel: "sonnet",
  defaultPermissionMode: "default",
  keybindings: {},
  diffMode: "unified",
  showThinking: true,
  claudePath: "claude",
  vimEnabled: false,
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

  it("forwards interrupt requests to the active query", async () => {
    let interruptCalls = 0
    const query = createFakeQuery({
      interrupt: async () => {
        interruptCalls += 1
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
    await service.interrupt()

    expect(interruptCalls).toBe(1)
  })

  it("keeps assistant text and tool calls as separate chronological rows", async () => {
    const service = await runServiceWithMessages([
      {
        type: "assistant",
        uuid: "assistant-1",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "text", text: "Let me inspect that file.", citations: null },
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "/src/index.ts" },
            },
          ],
        },
        session_id: "session-1",
      },
      {
        type: "assistant",
        uuid: "assistant-2",
        parent_tool_use_id: null,
        message: {
          content: "Here is the answer.",
        },
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

    expect(service.getState().messages.map((message) => `${message.kind}:${getMessageText(message)}`)).toEqual([
      "user:Run task projection test",
      "assistant:Let me inspect that file.",
      "tool_call:Read",
      "assistant:Here is the answer.",
    ])
  })

  it("captures thinking from streaming deltas and final assistant blocks", async () => {
    const service = await runServiceWithMessages([
      {
        type: "stream_event",
        uuid: "msg-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Analyzing the repository" },
        },
        session_id: "session-1",
      },
      {
        type: "stream_event",
        uuid: "msg-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "Here is the answer." },
        },
        session_id: "session-1",
      },
      {
        type: "assistant",
        uuid: "msg-1",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "thinking", thinking: "Analyzing the repository", signature: "sig-1" },
            { type: "text", text: "Here is the answer.", citations: null },
          ],
        },
        session_id: "session-1",
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.02,
        usage: { input_tokens: 200, output_tokens: 100 },
        session_id: "session-1",
      },
    ])

    const messages = service.getState().messages

    expect(messages.map((message) => `${message.kind}:${getMessageText(message)}`)).toEqual([
      "user:Run task projection test",
      "thinking:Analyzing the repository",
      "assistant:Here is the answer.",
    ])
    expect(messages[1]?.kind === "thinking" && messages[1].isStreaming).toBe(false)
    expect(messages[2]?.kind === "assistant" && messages[2].isStreaming).toBe(false)
  })

  it("merges consecutive thinking chunks until another event arrives", async () => {
    const service = await runServiceWithMessages([
      {
        type: "stream_event",
        uuid: "msg-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Plan " },
        },
        session_id: "session-1",
      },
      {
        type: "stream_event",
        uuid: "msg-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "thinking_delta", thinking: "search" },
        },
        session_id: "session-1",
      },
      {
        type: "assistant",
        uuid: "msg-1",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "thinking", thinking: "Plan ", signature: "sig-1" },
            { type: "thinking", thinking: "search", signature: "sig-2" },
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "/src/index.ts" },
            },
          ],
        },
        session_id: "session-1",
      },
      {
        type: "stream_event",
        uuid: "msg-2",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Summarize " },
        },
        session_id: "session-1",
      },
      {
        type: "stream_event",
        uuid: "msg-2",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "thinking_delta", thinking: "results" },
        },
        session_id: "session-1",
      },
      {
        type: "assistant",
        uuid: "msg-2",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "thinking", thinking: "Summarize ", signature: "sig-3" },
            { type: "thinking", thinking: "results", signature: "sig-4" },
            { type: "text", text: "Done.", citations: null },
          ],
        },
        session_id: "session-1",
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.02,
        usage: { input_tokens: 200, output_tokens: 100 },
        session_id: "session-1",
      },
    ])

    expect(service.getState().messages.map((message) => `${message.kind}:${getMessageText(message)}`)).toEqual([
      "user:Run task projection test",
      "thinking:Plan search",
      "tool_call:Read",
      "thinking:Summarize results",
      "assistant:Done.",
    ])
  })

  it("keeps streamed assistant text separated by tool rows across turns", async () => {
    const service = await runServiceWithMessages([
      {
        type: "stream_event",
        uuid: "msg-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Let me check that file." },
        },
        session_id: "session-1",
      },
      {
        type: "assistant",
        uuid: "msg-1",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "text", text: "Let me check that file.", citations: null },
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "/src/index.ts" },
            },
          ],
        },
        session_id: "session-1",
      },
      {
        type: "stream_event",
        uuid: "msg-2",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Here is the answer." },
        },
        session_id: "session-1",
      },
      {
        type: "assistant",
        uuid: "msg-2",
        parent_tool_use_id: null,
        message: {
          content: "Here is the answer.",
        },
        session_id: "session-1",
      },
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.02,
        usage: { input_tokens: 200, output_tokens: 100 },
        session_id: "session-1",
      },
    ])

    expect(service.getState().messages.map((message) => `${message.kind}:${getMessageText(message)}`)).toEqual([
      "user:Run task projection test",
      "assistant:Let me check that file.",
      "tool_call:Read",
      "assistant:Here is the answer.",
    ])
  })

  it("reuses one tool row when progress arrives before the final assistant tool block", async () => {
    const service = await runServiceWithMessages([
      {
        type: "tool_progress",
        tool_use_id: "tool-1",
        tool_name: "Read",
        parent_tool_use_id: null,
        elapsed_time_seconds: 0.5,
        uuid: "tool-progress-1",
        session_id: "session-1",
      },
      {
        type: "assistant",
        uuid: "assistant-1",
        parent_tool_use_id: null,
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
        session_id: "session-1",
      },
      {
        type: "tool_use_summary",
        summary: "Read src/index.ts",
        preceding_tool_use_ids: ["tool-1"],
        uuid: "tool-summary-1",
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

    const toolMessages = getToolCallMessages(service)

    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]).toMatchObject({
      toolCall: {
        id: "tool-1",
        name: "Read",
        input: { file_path: "/src/index.ts" },
        status: "completed",
        output: "Read src/index.ts",
        elapsedSeconds: 0.5,
      },
    })
  })

  it("merges live file-write tool results into the existing tool row without adding a user bubble", async () => {
    const service = await runServiceWithMessages([
      {
        type: "assistant",
        uuid: "assistant-1",
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Write",
              input: { file_path: "/tmp/example.ts", content: "const after = 2\n" },
            },
          ],
        },
        session_id: "session-1",
      },
      createUserToolResultMessage({
        uuid: "user-tool-result-1",
        toolUseIds: ["tool-1"],
        toolUseResult: createFileWriteToolResult({
          type: "update",
          filePath: "/tmp/example.ts",
          content: "const after = 2\n",
          originalFile: "const before = 1\n",
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ["-const before = 1", "+const after = 2"],
            },
          ],
        }),
      }),
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "session-1",
      },
    ])

    expect(service.getState().messages.filter((message) => message.kind === "user")).toHaveLength(1)
    expect(getToolCallMessages(service)).toMatchObject([
      {
        toolCall: {
          id: "tool-1",
          name: "Write",
          status: "completed",
          fileChange: {
            filePath: "/tmp/example.ts",
            changeType: "modified",
          },
        },
      },
    ])
    expect(getToolCallMessages(service)[0]?.toolCall.fileChange?.patch).toContain("+++ /tmp/example.ts")
  })

  it("rehydrates file diffs from session history tool results", async () => {
    const service = new ConversationService(TEST_CONFIG, undefined, {
      createQuery: () => createFakeQuery(),
      getQueryMetadata: async () => createEmptyMetadata(),
      getSessionMessages: async () => [
        { type: "user", uuid: "user-1", parent_tool_use_id: null, message: { content: "Earlier prompt" } },
        {
          type: "assistant",
          uuid: "assistant-1",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "Edit",
                input: { file_path: "/tmp/example.ts" },
              },
            ],
          },
        },
        createUserToolResultMessage({
          uuid: "user-tool-result-1",
          toolUseIds: ["tool-1"],
          toolUseResult: createFileEditToolResult({
            filePath: "/tmp/example.ts",
            oldString: "const before = 1",
            newString: "const after = 2",
            originalFile: "const before = 1\n",
            structuredPatch: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                lines: ["-const before = 1", "+const after = 2"],
              },
            ],
            userModified: false,
            replaceAll: false,
          }),
        }),
        {
          type: "assistant",
          uuid: "assistant-2",
          parent_tool_use_id: null,
          message: { content: "Updated the file." },
        },
      ],
      listSessions: async () => [],
      loadSupportedMetadata: async () => createEmptyMetadata(),
      resumeSession: () => createFakeQuery(),
    })

    await service.loadSession("session-1")

    expect(service.getState().messages.map((message) => `${message.kind}:${getMessageText(message)}`)).toEqual([
      "user:Earlier prompt",
      "tool_call:Edit",
      "assistant:Updated the file.",
    ])
    expect(getToolCallMessages(service)).toMatchObject([
      {
        toolCall: {
          id: "tool-1",
          fileChange: {
            filePath: "/tmp/example.ts",
            changeType: "modified",
          },
        },
      },
    ])
  })

  it("marks a running tool as completed once assistant text resumes", async () => {
    const service = await runServiceWithMessages([
      {
        type: "assistant",
        uuid: "assistant-1",
        parent_tool_use_id: null,
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
        session_id: "session-1",
      },
      {
        type: "assistant",
        uuid: "assistant-2",
        parent_tool_use_id: null,
        message: {
          content: "The file has been inspected.",
        },
        session_id: "session-1",
      },
    ])

    expect(getToolCallMessages(service)).toMatchObject([
      {
        toolCall: {
          id: "tool-1",
          name: "Read",
          status: "completed",
        },
      },
    ])
  })

  it("completes an earlier top-level Bash tool when a new tool starts in the same scope", async () => {
    const service = await runServiceWithMessages([
      {
        type: "assistant",
        uuid: "assistant-1",
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-bash-1",
              name: "Bash",
              input: { command: "ls" },
            },
          ],
        },
        session_id: "session-1",
      },
      {
        type: "tool_progress",
        tool_use_id: "tool-bash-1",
        tool_name: "Bash",
        parent_tool_use_id: null,
        elapsed_time_seconds: 0.8,
        uuid: "tool-progress-1",
        session_id: "session-1",
      },
      {
        type: "assistant",
        uuid: "assistant-2",
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-read-1",
              name: "Read",
              input: { file_path: "/src/index.ts" },
            },
          ],
        },
        session_id: "session-1",
      },
    ])

    expect(getToolCallMessages(service)).toMatchObject([
      {
        toolCall: {
          id: "tool-bash-1",
          name: "Bash",
          status: "completed",
          elapsedSeconds: 0.8,
        },
      },
      {
        toolCall: {
          id: "tool-read-1",
          name: "Read",
          status: "running",
        },
      },
    ])
  })

  it("attaches tool rows to the correct task scope", async () => {
    const service = await runServiceWithMessages([
      {
        type: "tool_progress",
        tool_use_id: "nested-tool-1",
        tool_name: "Grep",
        parent_tool_use_id: "task-root-tool",
        elapsed_time_seconds: 0.4,
        uuid: "tool-progress-1",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "task-root-tool",
        description: "Inspect command routing",
        task_type: "local_agent",
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

    const toolMessages = getToolCallMessages(service)

    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]).toMatchObject({
      taskId: "task-1",
      parentToolUseId: "task-root-tool",
      toolCall: {
        id: "nested-tool-1",
        name: "Grep",
        status: "completed",
      },
    })
  })

  it("settles running task-scoped tool calls when the task finishes", async () => {
    const service = await runServiceWithMessages([
      {
        type: "tool_progress",
        tool_use_id: "nested-tool-1",
        tool_name: "Grep",
        parent_tool_use_id: "task-root-tool",
        elapsed_time_seconds: 0.4,
        uuid: "tool-progress-1",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "task-root-tool",
        description: "Inspect command routing",
        task_type: "local_agent",
        uuid: "task-start-1",
        session_id: "session-1",
      },
      {
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "completed",
        output_file: "/tmp/task-1.md",
        summary: "done",
        uuid: "task-finish-1",
        session_id: "session-1",
      },
    ])

    expect(getToolCallMessages(service)).toMatchObject([
      {
        taskId: "task-1",
        toolCall: {
          id: "nested-tool-1",
          status: "completed",
        },
      },
    ])
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

  it("parses a live TodoWrite result into the todoTracker state slice", async () => {
    const service = await runServiceWithMessages([
      {
        type: "assistant",
        uuid: "assistant-1",
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-todo-1",
              name: "TodoWrite",
              input: {
                todos: [
                  { content: "Step one", status: "completed" },
                  { content: "Step two", status: "in_progress", activeForm: "doing step two" },
                  { content: "Step three", status: "pending" },
                ],
              },
            },
          ],
        },
        session_id: "session-1",
      },
      createUserToolResultMessage({
        uuid: "user-todo-result-1",
        toolUseIds: ["tool-todo-1"],
        toolUseResult: {
          newTodos: [
            { content: "Step one", status: "completed" },
            { content: "Step two", status: "in_progress", activeForm: "doing step two" },
            { content: "Step three", status: "pending" },
          ],
          oldTodos: [],
        },
      }),
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "session-1",
      },
    ])

    const { todoTracker } = service.getState()

    expect(todoTracker).not.toBeNull()
    expect(todoTracker?.items).toHaveLength(3)
    expect(todoTracker?.items[0]).toEqual({ content: "Step one", status: "completed" })
    expect(todoTracker?.items[1]).toMatchObject({ status: "in_progress", activeForm: "doing step two" })
    expect(todoTracker?.lastSourceToolUseId).toBe("tool-todo-1")
  })

  it("updates todoTracker with the latest TodoWrite result when the tool fires multiple times", async () => {
    const service = await runServiceWithMessages([
      {
        type: "assistant",
        uuid: "assistant-1",
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-todo-1",
              name: "TodoWrite",
              input: { todos: [{ content: "Task A", status: "in_progress" }] },
            },
          ],
        },
        session_id: "session-1",
      },
      createUserToolResultMessage({
        uuid: "user-todo-result-1",
        toolUseIds: ["tool-todo-1"],
        toolUseResult: { newTodos: [{ content: "Task A", status: "in_progress" }] },
      }),
      {
        type: "assistant",
        uuid: "assistant-2",
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-todo-2",
              name: "TodoWrite",
              input: { todos: [{ content: "Task A", status: "completed" }] },
            },
          ],
        },
        session_id: "session-1",
      },
      createUserToolResultMessage({
        uuid: "user-todo-result-2",
        toolUseIds: ["tool-todo-2"],
        toolUseResult: { newTodos: [{ content: "Task A", status: "completed" }] },
      }),
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "session-1",
      },
    ])

    expect(service.getState().todoTracker?.items[0]?.status).toBe("completed")
    expect(service.getState().todoTracker?.lastSourceToolUseId).toBe("tool-todo-2")
  })

  it("clears todoTracker when starting a new session", async () => {
    const service = await runServiceWithMessages([
      {
        type: "assistant",
        uuid: "assistant-1",
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-todo-1",
              name: "TodoWrite",
              input: { todos: [{ content: "Task", status: "in_progress" }] },
            },
          ],
        },
        session_id: "session-1",
      },
      createUserToolResultMessage({
        uuid: "user-todo-result-1",
        toolUseIds: ["tool-todo-1"],
        toolUseResult: { newTodos: [{ content: "Task", status: "in_progress" }] },
      }),
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "session-1",
      },
    ])

    expect(service.getState().todoTracker).not.toBeNull()
    await service.newSession()
    expect(service.getState().todoTracker).toBeNull()
  })

  it("rehydrates todoTracker from session history on loadSession", async () => {
    const service = new ConversationService(TEST_CONFIG, undefined, {
      createQuery: () => createFakeQuery(),
      getQueryMetadata: async () => createEmptyMetadata(),
      getSessionMessages: async () => [
        {
          type: "assistant",
          uuid: "assistant-1",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-todo-1",
                name: "TodoWrite",
                input: { todos: [{ content: "Archived task", status: "completed" }] },
              },
            ],
          },
        },
        createUserToolResultMessage({
          uuid: "user-todo-result-1",
          toolUseIds: ["tool-todo-1"],
          toolUseResult: { newTodos: [{ content: "Archived task", status: "completed" }] },
        }),
      ],
      listSessions: async () => [],
      loadSupportedMetadata: async () => createEmptyMetadata(),
      resumeSession: () => createFakeQuery(),
    })

    await service.loadSession("session-1")

    const { todoTracker } = service.getState()
    expect(todoTracker).not.toBeNull()
    expect(todoTracker?.items).toHaveLength(1)
    expect(todoTracker?.items[0]).toMatchObject({ content: "Archived task", status: "completed" })
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
  readonly interrupt?: Query["interrupt"]
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
    interrupt: overrides?.interrupt ?? (async () => {
      return
    }),
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

function createUserToolResultMessage(options: {
  readonly uuid: string
  readonly toolUseIds: readonly string[]
  readonly toolUseResult: unknown
}): Record<string, unknown> {
  return {
    type: "user",
    uuid: options.uuid,
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: options.toolUseIds.map((toolUseId) => ({
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "ok",
      })),
    },
    tool_use_result: options.toolUseResult,
  }
}

function createFileWriteToolResult(result: {
  readonly type: "create" | "update"
  readonly filePath: string
  readonly content: string
  readonly originalFile: string | null
  readonly structuredPatch: readonly {
    readonly oldStart: number
    readonly oldLines: number
    readonly newStart: number
    readonly newLines: number
    readonly lines: readonly string[]
  }[]
}): Record<string, unknown> {
  return { ...result }
}

function createFileEditToolResult(result: {
  readonly filePath: string
  readonly oldString: string
  readonly newString: string
  readonly originalFile: string
  readonly structuredPatch: readonly {
    readonly oldStart: number
    readonly oldLines: number
    readonly newStart: number
    readonly newLines: number
    readonly lines: readonly string[]
  }[]
  readonly userModified: boolean
  readonly replaceAll: boolean
}): Record<string, unknown> {
  return { ...result }
}

function getTaskMessages(service: ConversationService): TaskDisplayMessage[] {
  return service.getState().messages.filter(
    (message): message is TaskDisplayMessage => message.kind === "task",
  )
}

function getToolCallMessages(service: ConversationService): ToolCallDisplayMessage[] {
  return service.getState().messages.filter(
    (message): message is ToolCallDisplayMessage => message.kind === "tool_call",
  )
}

function getMessageText(message: DisplayMessage | undefined): string {
  if (!message) {
    return ""
  }

  switch (message.kind) {
    case "user":
    case "assistant":
    case "thinking":
    case "system":
    case "error":
      return message.text
    case "tool_call":
      return message.toolCall.name
    case "task":
      return message.task.description
  }
}
