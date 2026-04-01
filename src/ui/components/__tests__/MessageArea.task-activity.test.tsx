import { afterEach, describe, expect, it } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"
import { act, createRef } from "react"
import { MessageUUID, type SpawnedTask } from "#sdk/types"
import { DEFAULT_CONFIG } from "#config/schema"
import { ConversationService } from "#state/conversation-service"
import {
  initialConversationState,
  type ConversationState,
  type TaskDisplayMessage,
} from "#state/types"
import { ConversationServiceProvider } from "#ui/hooks"
import { MessageArea } from "#ui/components/MessageArea"

let renderedView: Awaited<ReturnType<typeof renderMessageArea>> | null = null

afterEach(() => {
  if (renderedView) {
    act(() => {
      renderedView?.testSetup.renderer.destroy()
    })
    renderedView = null
  }
})

describe("MessageArea task activity", () => {
  it("renders a running spawned task row with description and live detail", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createTaskMessage({
            status: "running",
            description: "Inspect slash command routing",
            summary: "Searching src/commands and ui picker modules",
            usage: {
              durationMs: 3200,
              toolUses: 2,
              totalTokens: 640,
            },
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("running")
    expect(frame).toContain("subagent")
    expect(frame).toContain("Inspect slash command routing")
    expect(frame).toContain("Searching src/commands and ui picker modules")
    expect(frame).toContain("3.2s, 2 tools, 640 tokens")
    expect(getLineContaining(frame, "running")).toContain("│")
  })

  it("renders completed spawned tasks as a final static state", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createTaskMessage({
            status: "completed",
            description: "Summarize repo architecture",
            summary: "Found command handlers in src/commands and transcript UI in src/ui",
            usage: {
              durationMs: 12_000,
              toolUses: 4,
              totalTokens: 1280,
            },
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("completed")
    expect(frame).toContain("Summarize repo architecture")
    expect(frame).toContain("12s, 4 tools, 1280 tokens")
    expect(frame).not.toContain("running")
  })

  it("renders standalone tool rows without the old work log header", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createToolCallMessage({
            id: "tool-1",
            name: "Read",
            input: { file_path: "/src/index.ts" },
            status: "completed",
            output: "Read src/index.ts",
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("tool")
    expect(frame).toContain("Read")
    expect(frame).toContain("/src/index.ts")
    expect(frame).not.toContain("work log")
    expect(getLineContaining(frame, "tool")).toContain("│")
  })

  it("renders consecutive standalone tool rows inside a single tool frame", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createToolCallMessage({
            id: "tool-1",
            name: "Read",
            input: { file_path: "/src/index.ts" },
            status: "completed",
          }),
          createToolCallMessage({
            id: "tool-2",
            name: "Grep",
            input: { pattern: "slash" },
            status: "completed",
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)
    const toolHeaders = frame.split("\n").filter((line) => line.includes("tool") && line.includes("│"))

    expect(frame).toContain("Read")
    expect(frame).toContain("Grep")
    expect(toolHeaders).toHaveLength(1)
  })

  it("hides the spawn tool row when a matching task row exists", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createToolCallMessage({
            id: "spawn-tool-1",
            name: "SpawnAgent",
            input: { description: "launch marker" },
            status: "running",
          }),
          createTaskMessage({
            id: "task-1",
            toolUseId: "spawn-tool-1",
            status: "running",
            description: "Inspect command routing",
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("Inspect command routing")
    expect(frame).not.toContain("SpawnAgent")
    expect(frame).not.toContain("launch marker")
  })

  it("renders only the last two active subagent tool calls inside the task row", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createTaskMessage({
            id: "task-1",
            toolUseId: "task-root-tool",
            status: "running",
            description: "Inspect command routing",
          }),
          createToolCallMessage({
            id: "tool-1",
            name: "Read",
            input: { file_path: "/src/one.ts" },
            taskId: "task-1",
            parentToolUseId: "task-root-tool",
          }),
          createToolCallMessage({
            id: "tool-2",
            name: "Grep",
            input: { pattern: "slash" },
            taskId: "task-1",
            parentToolUseId: "task-root-tool",
          }),
          createToolCallMessage({
            id: "tool-3",
            name: "Write",
            input: { file_path: "/tmp/out.md" },
            taskId: "task-1",
            parentToolUseId: "task-root-tool",
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("Inspect command routing")
    expect(frame).toContain("live tools")
    expect(frame).toContain("Grep")
    expect(frame).toContain("Write")
    expect(frame).not.toContain("Read")
  })

  it("removes completed subagent tool calls from the task row", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createTaskMessage({
            id: "task-1",
            toolUseId: "task-root-tool",
            status: "running",
            description: "Inspect command routing",
          }),
          createToolCallMessage({
            id: "tool-1",
            name: "Read",
            status: "completed",
            input: { file_path: "/src/index.ts" },
            taskId: "task-1",
            parentToolUseId: "task-root-tool",
          }),
          createToolCallMessage({
            id: "tool-2",
            name: "Grep",
            status: "running",
            input: { pattern: "command" },
            taskId: "task-1",
            parentToolUseId: "task-root-tool",
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("Grep")
    expect(frame).not.toContain("Read")
  })

  it("renders thinking rows when visibility is enabled", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        showThinking: true,
        messages: [createThinkingMessage("Map the current flow before replying")],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("thinking")
    expect(frame).toContain("Map the current flow before replying")
  })

  it("hides thinking rows when visibility is disabled", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        showThinking: false,
        messages: [
          createThinkingMessage("Map the current flow before replying"),
          createToolCallMessage({
            id: "tool-2",
            name: "Grep",
            input: { pattern: "renderer" },
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).not.toContain("Map the current flow before replying")
    expect(frame).toContain("Grep")
  })

  it("renders the content from merged consecutive thinking rows", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        showThinking: true,
        messages: [
          createThinkingMessage("Plan the change", { id: "thinking:1" }),
          createThinkingMessage("Check the renderer", { id: "thinking:2" }),
          createToolCallMessage({
            id: "tool-2",
            name: "Grep",
            input: { pattern: "thinking" },
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("Plan the change")
    expect(frame).toContain("Check the renderer")
    expect(frame).toContain("Grep")
  })
})

async function renderMessageArea(initialState: ConversationState) {
  const service = new ConversationService(DEFAULT_CONFIG, initialState)
  const testSetup = await testRender(
    <ConversationServiceProvider value={service}>
      <MessageArea scrollRef={createRef<ScrollBoxRenderable | null>()} />
    </ConversationServiceProvider>,
    { width: 100, height: 20 },
  )

  await renderFrame(testSetup)

  return { testSetup, service }
}

function createConversationState(overrides?: {
  readonly messages?: readonly ConversationState["messages"][number][]
  readonly showThinking?: boolean
}): ConversationState {
  return {
    ...initialConversationState,
    startup: {
      auth: { status: "ready" },
      resume: { status: "ready" },
      metadata: { status: "ready" },
    },
    model: DEFAULT_CONFIG.defaultModel,
    permissionMode: DEFAULT_CONFIG.defaultPermissionMode,
    themeName: DEFAULT_CONFIG.theme,
    diffMode: DEFAULT_CONFIG.diffMode,
    showThinking: overrides?.showThinking ?? DEFAULT_CONFIG.showThinking,
    vimEnabled: false,
    vimMode: "insert",
    messages: overrides?.messages ?? [],
  }
}

function createTaskMessage(overrides?: Partial<SpawnedTask>): TaskDisplayMessage {
  const task = createTask(overrides)

  return {
    kind: "task",
    uuid: MessageUUID(`task:${task.id}`),
    task,
    timestamp: new Date("2026-03-30T10:00:00Z"),
  }
}

function createTask(overrides?: Partial<SpawnedTask>): SpawnedTask {
  return {
    id: overrides?.id ?? "task-1",
    description: overrides?.description ?? "Inspect repository",
    taskType: overrides?.taskType === undefined ? "local_agent" : overrides.taskType,
    workflowName: overrides?.workflowName ?? null,
    toolUseId: overrides?.toolUseId ?? null,
    prompt: overrides?.prompt ?? null,
    status: overrides?.status ?? "running",
    summary: overrides?.summary ?? null,
    lastToolName: overrides?.lastToolName ?? null,
    outputFile: overrides?.outputFile ?? null,
    usage: overrides?.usage ?? null,
  }
}

function createToolCallMessage(overrides?: {
  readonly id?: string
  readonly name?: string
  readonly input?: Record<string, unknown>
  readonly status?: "running" | "completed" | "error"
  readonly output?: string | null
  readonly elapsedSeconds?: number | null
  readonly taskId?: string | null
  readonly parentToolUseId?: string | null
}): ConversationState["messages"][number] {
  return {
    kind: "tool_call",
    uuid: MessageUUID(`tool:${overrides?.id ?? "tool-1"}`),
    toolCall: {
      id: overrides?.id ?? "tool-1",
      name: overrides?.name ?? "Read",
      input: overrides?.input ?? {},
      status: overrides?.status ?? "running",
      output: overrides?.output ?? null,
      elapsedSeconds: overrides?.elapsedSeconds ?? null,
    },
    timestamp: new Date("2026-03-30T10:00:00Z"),
    taskId: overrides?.taskId ?? null,
    parentToolUseId: overrides?.parentToolUseId ?? null,
  }
}

function createThinkingMessage(
  text: string,
  overrides?: {
    readonly id?: string
    readonly isStreaming?: boolean
    readonly taskId?: string | null
    readonly parentToolUseId?: string | null
  },
): ConversationState["messages"][number] {
  return {
    kind: "thinking",
    uuid: MessageUUID(overrides?.id ?? "thinking:1"),
    text,
    isStreaming: overrides?.isStreaming ?? false,
    timestamp: new Date("2026-03-30T10:00:00Z"),
    taskId: overrides?.taskId ?? null,
    parentToolUseId: overrides?.parentToolUseId ?? null,
  }
}

async function renderFrame(testSetup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await act(async () => {
    await Bun.sleep(0)
    await testSetup.renderOnce()
  })

  return testSetup.captureCharFrame()
}

function getLineContaining(frame: string, text: string): string {
  const line = frame.split("\n").find((entry) => entry.includes(text))

  expect(line).toBeDefined()

  return line!
}
