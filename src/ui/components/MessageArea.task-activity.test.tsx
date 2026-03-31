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

async function renderFrame(testSetup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await act(async () => {
    await Bun.sleep(0)
    await testSetup.renderOnce()
  })

  return testSetup.captureCharFrame()
}
