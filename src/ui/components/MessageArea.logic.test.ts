import { describe, expect, it } from "bun:test"
import { MessageUUID, type SpawnedTask, type ToolCall } from "#sdk/types"
import type { DisplayMessage } from "#state/types"
import {
  formatTaskKindLabel,
  formatTaskUsage,
  getMessageLayout,
  getTaskDetailLine,
  getTaskStatusPresentation,
  getToolBriefDetail,
  getToolStatusPresentation,
  getVisibleToolCalls,
  normalizeToolLabel,
  shouldShowAssistantResponseDivider,
} from "#ui/components/MessageArea.logic"

describe("shouldShowAssistantResponseDivider", () => {
  it("shows a divider when an assistant turn follows a user turn", () => {
    const messages = [
      createUserMessage("u-1"),
      createAssistantMessage("a-1"),
    ] satisfies readonly DisplayMessage[]

    expect(shouldShowAssistantResponseDivider(messages, 1)).toBe(true)
  })

  it("ignores system and error rows between conversational turns", () => {
    const messages = [
      createUserMessage("u-1"),
      createSystemMessage("s-1"),
      createErrorMessage("e-1"),
      createAssistantMessage("a-1"),
    ] satisfies readonly DisplayMessage[]

    expect(shouldShowAssistantResponseDivider(messages, 3)).toBe(true)
  })

  it("does not show a divider between consecutive assistant rows", () => {
    const messages = [
      createAssistantMessage("a-1"),
      createSystemMessage("s-1"),
      createAssistantMessage("a-2"),
    ] satisfies readonly DisplayMessage[]

    expect(shouldShowAssistantResponseDivider(messages, 2)).toBe(false)
  })
})

describe("getVisibleToolCalls", () => {
  it("returns the newest rows when collapsed", () => {
    const toolCalls = [
      createToolCall("1", "Read"),
      createToolCall("2", "Grep"),
      createToolCall("3", "Write"),
      createToolCall("4", "Bash"),
    ]

    const result = getVisibleToolCalls(toolCalls, false, 2)

    expect(result.visibleToolCalls.map((toolCall) => toolCall.id)).toEqual(["3", "4"])
    expect(result.hiddenCount).toBe(2)
    expect(result.hasOverflow).toBe(true)
  })

  it("returns all rows when expanded", () => {
    const toolCalls = [
      createToolCall("1", "Read"),
      createToolCall("2", "Write"),
    ]

    const result = getVisibleToolCalls(toolCalls, true, 1)

    expect(result.visibleToolCalls).toEqual(toolCalls)
    expect(result.hiddenCount).toBe(0)
    expect(result.hasOverflow).toBe(true)
  })
})

describe("tool previews", () => {
  it("maps running tools to a spinner presentation and completed tools to static icons", () => {
    expect(getToolStatusPresentation("running")).toEqual({ kind: "spinner", tone: "warning" })
    expect(getToolStatusPresentation("completed")).toEqual({
      kind: "icon",
      icon: "✓",
      tone: "success",
    })
    expect(getToolStatusPresentation("error")).toEqual({
      kind: "icon",
      icon: "✗",
      tone: "error",
    })
  })

  it("normalizes compact labels", () => {
    expect(normalizeToolLabel("Read completed")).toBe("Read")
    expect(normalizeToolLabel("Write complete")).toBe("Write")
  })

  it("uses the most relevant string input field and truncates it", () => {
    const detail = getToolBriefDetail({
      input: {
        command: "bun run a-command --with very long arguments that should be shortened into one line",
      },
      output: null,
    })

    expect(detail).toBe("bun run a-command --with very long arguments that should ...")
  })

  it("falls back to output when no preview input field is present", () => {
    const detail = getToolBriefDetail({
      input: {},
      output: "line one\nline two",
    })

    expect(detail).toBe("line one line two")
  })

  it("maps task statuses to deterministic task activity presentation", () => {
    expect(getTaskStatusPresentation("running")).toEqual({ kind: "spinner", tone: "warning" })
    expect(getTaskStatusPresentation("completed")).toEqual({
      kind: "icon",
      icon: "✓",
      tone: "success",
    })
    expect(getTaskStatusPresentation("failed")).toEqual({
      kind: "icon",
      icon: "✗",
      tone: "error",
    })
    expect(getTaskStatusPresentation("stopped")).toEqual({
      kind: "icon",
      icon: "■",
      tone: "primary",
    })
  })

  it("formats friendly task kind labels", () => {
    expect(formatTaskKindLabel(createTask({ taskType: "local_agent" }))).toBe("subagent")
    expect(
      formatTaskKindLabel(createTask({ taskType: "local_workflow", workflowName: "spec_review" })),
    ).toBe("workflow spec review")
    expect(formatTaskKindLabel(createTask({ taskType: "remote_sync_job" }))).toBe("remote sync job")
    expect(formatTaskKindLabel(createTask({ taskType: null }))).toBe("task")
  })

  it("prefers task summaries and falls back to the latest tool name", () => {
    expect(
      getTaskDetailLine(
        createTask({
          summary: "Scanned the repository and found slash command handlers",
          lastToolName: "Grep",
        }),
      ),
    ).toBe("Scanned the repository and found slash command handlers")

    expect(
      getTaskDetailLine(
        createTask({
          summary: null,
          lastToolName: "Read completed",
        }),
      ),
    ).toBe("using Read")
  })

  it("formats task usage into a compact metadata line", () => {
    expect(
      formatTaskUsage({
        durationMs: 3200,
        toolUses: 2,
        totalTokens: 640,
      }),
    ).toBe("3.2s, 2 tools, 640 tokens")

    expect(
      formatTaskUsage({
        durationMs: 65_000,
        toolUses: 1,
        totalTokens: 1,
      }),
    ).toBe("1m 5s, 1 tool, 1 token")
  })
})

describe("getMessageLayout", () => {
  it("keeps compact layouts narrow", () => {
    expect(getMessageLayout(80)).toEqual({
      compact: true,
      horizontalPadding: 1,
      columnWidth: 78,
      userBubbleWidth: 76,
      sectionPaddingY: 0,
      metaGapBottom: 0,
    })
  })

  it("caps wide layouts to the centered column width", () => {
    expect(getMessageLayout(140)).toEqual({
      compact: false,
      horizontalPadding: 4,
      columnWidth: 104,
      userBubbleWidth: 81,
      sectionPaddingY: 1,
      metaGapBottom: 1,
    })
  })
})

function createUserMessage(id: string): DisplayMessage {
  return {
    kind: "user",
    uuid: MessageUUID(id),
    text: "hello",
    timestamp: new Date("2026-03-30T10:00:00Z"),
  }
}

function createAssistantMessage(id: string): DisplayMessage {
  return {
    kind: "assistant",
    uuid: MessageUUID(id),
    text: "response",
    toolCalls: [],
    isStreaming: false,
    timestamp: new Date("2026-03-30T10:00:01Z"),
  }
}

function createSystemMessage(id: string): DisplayMessage {
  return {
    kind: "system",
    uuid: MessageUUID(id),
    text: "system note",
    timestamp: new Date("2026-03-30T10:00:02Z"),
  }
}

function createErrorMessage(id: string): DisplayMessage {
  return {
    kind: "error",
    uuid: MessageUUID(id),
    text: "boom",
    recoverable: true,
    timestamp: new Date("2026-03-30T10:00:03Z"),
  }
}

function createToolCall(id: string, name: string): ToolCall {
  return {
    id,
    name,
    input: {},
    status: "completed",
    output: null,
    elapsedSeconds: null,
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
