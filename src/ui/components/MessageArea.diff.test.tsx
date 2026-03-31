import { afterEach, describe, expect, it } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"
import { act, createRef } from "react"
import { MessageUUID } from "#sdk/types"
import { DEFAULT_CONFIG } from "#config/schema"
import { ConversationService } from "#state/conversation-service"
import { initialConversationState, type ConversationState } from "#state/types"
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

describe("MessageArea diff rendering", () => {
  it("renders inline diffs for completed file-modifying tool rows", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createToolCallMessage({
            id: "tool-1",
            name: "Write",
            input: { file_path: "/tmp/example.ts" },
            status: "completed",
            fileChange: {
              filePath: "/tmp/example.ts",
              changeType: "modified",
              patch: [
                "--- /tmp/example.ts",
                "+++ /tmp/example.ts",
                "@@ -1 +1 @@",
                "-const before = 1",
                "+const after = 2",
                "",
              ].join("\n"),
            },
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("Write")
    expect(frame).toContain("modified /tmp/example.ts")
    expect(frame).toContain("const before = 1")
    expect(frame).toContain("const after = 2")
  })

  it("switches diff layouts when the diff mode changes", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createToolCallMessage({
            id: "tool-1",
            name: "Edit",
            input: { file_path: "/tmp/example.ts" },
            status: "completed",
            fileChange: {
              filePath: "/tmp/example.ts",
              changeType: "modified",
              patch: [
                "--- /tmp/example.ts",
                "+++ /tmp/example.ts",
                "@@ -1,2 +1,2 @@",
                "-const before = 1",
                "-const keep = true",
                "+const after = 2",
                "+const keep = true",
                "",
              ].join("\n"),
            },
          }),
        ],
      }),
    )

    const unifiedFrame = await renderFrame(renderedView.testSetup)

    act(() => {
      renderedView?.service.toggleDiffMode()
    })

    const splitFrame = await renderFrame(renderedView.testSetup)

    expect(unifiedFrame).not.toEqual(splitFrame)
    expect(splitFrame).toContain("const after = 2")
  })

  it("keeps non-file tools compact", async () => {
    renderedView = await renderMessageArea(
      createConversationState({
        messages: [
          createToolCallMessage({
            id: "tool-1",
            name: "Read",
            input: { file_path: "/tmp/example.ts" },
            status: "completed",
            output: "Read /tmp/example.ts",
          }),
        ],
      }),
    )

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("Read")
    expect(frame).not.toContain("const before = 1")
    expect(frame).not.toContain("modified /tmp/example.ts")
  })
})

async function renderMessageArea(initialState: ConversationState) {
  const service = new ConversationService(DEFAULT_CONFIG, initialState)
  const testSetup = await testRender(
    <ConversationServiceProvider value={service}>
      <MessageArea scrollRef={createRef<ScrollBoxRenderable | null>()} />
    </ConversationServiceProvider>,
    { width: 120, height: 24 },
  )

  await renderFrame(testSetup)

  return { testSetup, service }
}

function createConversationState(overrides?: {
  readonly diffMode?: "unified" | "split"
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
    diffMode: overrides?.diffMode ?? DEFAULT_CONFIG.diffMode,
    showThinking: DEFAULT_CONFIG.showThinking,
    vimEnabled: false,
    vimMode: "insert",
    messages: overrides?.messages ?? [],
  }
}

function createToolCallMessage(overrides?: {
  readonly id?: string
  readonly name?: string
  readonly input?: Record<string, unknown>
  readonly status?: "running" | "completed" | "error"
  readonly output?: string | null
  readonly elapsedSeconds?: number | null
  readonly fileChange?: {
    readonly filePath: string
    readonly patch: string
    readonly changeType: "added" | "modified"
  }
}): ConversationState["messages"][number] {
  return {
    kind: "tool_call",
    uuid: MessageUUID(`tool:${overrides?.id ?? "tool-1"}`),
    toolCall: {
      id: overrides?.id ?? "tool-1",
      name: overrides?.name ?? "Write",
      input: overrides?.input ?? {},
      status: overrides?.status ?? "completed",
      output: overrides?.output ?? null,
      elapsedSeconds: overrides?.elapsedSeconds ?? null,
      ...(overrides?.fileChange ? { fileChange: overrides.fileChange } : {}),
    },
    timestamp: new Date("2026-03-30T10:00:00Z"),
    taskId: null,
    parentToolUseId: null,
  }
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
