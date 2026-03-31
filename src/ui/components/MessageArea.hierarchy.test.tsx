import { afterEach, describe, expect, it } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"
import { act, createRef } from "react"
import { MessageUUID, type SpawnedTask } from "#sdk/types"
import { DEFAULT_CONFIG } from "#config/schema"
import { ConversationService } from "#state/conversation-service"
import { initialConversationState, type ConversationState, type TaskDisplayMessage } from "#state/types"
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

describe("MessageArea hierarchy", () => {
  it("renders user metadata inside the primary message frame", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [createUserMessage("Review the current transcript layout.")],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("Review the current transcript layout.")
    expect(getLineContaining(frame, "you")).toContain("│")
  })

  it("renders scoped assistant output inside a framed secondary header", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createTaskMessage({
            id: "task-1",
            description: "Inspect command routing",
          }),
          createAssistantMessage("The task-scoped assistant reply.", {
            id: "assistant:1",
            taskId: "task-1",
            isStreaming: true,
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)
    const assistantHeaderLine = getLineContaining(frame, "claude")

    expect(assistantHeaderLine).toContain("│")
    expect(assistantHeaderLine).toContain("subagent: Inspect command routing")
    expect(assistantHeaderLine).toContain("streaming")
    expect(frame).not.toContain("-- response --")
  })

  it("keeps tertiary thinking metadata inside the frame while streaming", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        showThinking: true,
        messages: [
          createThinkingMessage("Map the current flow before replying", {
            id: "thinking:1",
            isStreaming: true,
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)
    const thinkingHeaderLine = getLineContaining(frame, "thinking")

    expect(thinkingHeaderLine).toContain("│")
    expect(thinkingHeaderLine).toContain("streaming")
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

function createUserMessage(text: string): ConversationState["messages"][number] {
  return {
    kind: "user",
    uuid: MessageUUID("user:1"),
    text,
    timestamp: new Date("2026-03-30T10:00:00Z"),
  }
}

function createAssistantMessage(
  text: string,
  overrides?: {
    readonly id?: string
    readonly isStreaming?: boolean
    readonly taskId?: string | null
    readonly parentToolUseId?: string | null
  },
): ConversationState["messages"][number] {
  return {
    kind: "assistant",
    uuid: MessageUUID(overrides?.id ?? "assistant:1"),
    text,
    isStreaming: overrides?.isStreaming ?? false,
    timestamp: new Date("2026-03-30T10:00:01Z"),
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
    timestamp: new Date("2026-03-30T10:00:02Z"),
    taskId: overrides?.taskId ?? null,
    parentToolUseId: overrides?.parentToolUseId ?? null,
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

function getLineContaining(frame: string, text: string): string {
  const line = frame.split("\n").find((entry) => entry.includes(text))

  expect(line).toBeDefined()

  return line!
}

async function renderFrame(testSetup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await act(async () => {
    await Bun.sleep(0)
    await testSetup.renderOnce()
    await Bun.sleep(0)
    await testSetup.renderOnce()
  })

  return testSetup.captureCharFrame()
}
