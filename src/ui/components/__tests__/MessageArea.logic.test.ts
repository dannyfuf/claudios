import { describe, expect, it } from "bun:test"
import { MessageUUID, type SpawnedTask, type ToolCall } from "#sdk/types"
import type { DisplayMessage, ThinkingDisplayMessage } from "#state/types"
import {
  formatMessageTimestamp,
  getMessageFrameIntent,
  formatTaskKindLabel,
  formatTodoSummaryLine,
  getMessageHeaderModel,
  getMessagePresentation,
  getMessageTier,
  getToolCallDiffFileChange,
  getTaskContextLabel,
  formatTaskUsage,
  getMessageLayout,
  getTaskDetailLine,
  getTaskStatusPresentation,
  getToolBriefDetail,
  getToolStatusPresentation,
  getTodoProgress,
  mergeVisibleMessages,
  mergeConsecutiveThinkingMessages,
  normalizeToolLabel,
} from "#ui/components/MessageArea.logic"

describe("message presentation helpers", () => {
  it("maps semantic message kinds into the user, assistant, and activity tiers", () => {
    const cases = [
      [createUserMessage("u-1"), "user"],
      [createAssistantMessage("a-1"), "assistant"],
      [createToolCallMessage("tool-1", "Read"), "activity"],
      [createTaskMessage("task-1"), "activity"],
      [createErrorMessage("e-1"), "activity"],
      [createSystemMessage("s-1"), "activity"],
      [createThinkingMessage("t-1"), "activity"],
    ] as const satisfies readonly (readonly [DisplayMessage, ReturnType<typeof getMessageTier>])[]

    for (const [message, expectedTier] of cases) {
      expect(getMessageTier(message)).toBe(expectedTier)
    }
  })

  it("derives assistant headers with scoped context and streaming state", () => {
    const assistantMessage = {
      kind: "assistant",
      uuid: MessageUUID("a-1"),
      text: "response",
      isStreaming: true,
      timestamp: new Date("2026-03-30T10:00:01Z"),
      taskId: null,
      parentToolUseId: null,
    } satisfies DisplayMessage

    expect(
      getMessageHeaderModel(assistantMessage, "subagent: Inspect command routing"),
    ).toEqual({
      label: "claude",
      labelEmphasis: "regular",
      labelTone: "muted",
      contextLabel: "subagent: Inspect command routing",
      timestamp: formatMessageTimestamp(assistantMessage.timestamp),
      indicator: null,
      streamingTone: "primary",
    })
  })

  it("keeps user frames right-aligned and task frames status-aware", () => {
    expect(getMessageFrameIntent(createUserMessage("u-1"))).toEqual({
      alignment: "right",
      width: "user",
      surface: "userSurface",
      border: "strong",
      borderTone: null,
    })

    expect(getMessagePresentation(createTaskMessage("task-1"), null)).toMatchObject({
      tier: "activity",
      frame: {
        alignment: "left",
        width: "column",
        surface: "toolSurface",
        border: "status",
        borderTone: "warning",
      },
      header: {
        label: "running",
        contextLabel: "subagent",
        labelTone: "warning",
        indicator: { kind: "spinner", tone: "warning" },
      },
    })
  })

  it("gives assistant replies their own framed surface", () => {
    expect(getMessageFrameIntent(createAssistantMessage("a-1"))).toEqual({
      alignment: "left",
      width: "column",
      surface: "assistantSurface",
      border: "subtle",
      borderTone: null,
    })
  })
})

describe("mergeConsecutiveThinkingMessages", () => {
  it("folds adjacent thinking rows into a single display row", () => {
    const messages = [
      createThinkingMessage("t-1", "Plan the change"),
      createThinkingMessage("t-2", "Check the message renderer"),
      createAssistantMessage("a-1"),
    ] satisfies readonly DisplayMessage[]

    expect(mergeConsecutiveThinkingMessages(messages)).toEqual([
      {
        ...createThinkingMessage("t-1", "Plan the change"),
        text: "Plan the change\nCheck the message renderer",
        timestamp: new Date("2026-03-30T10:00:01Z"),
      },
      createAssistantMessage("a-1"),
    ])
  })

  it("stops merging once a non-thinking row appears", () => {
    const messages = [
      createThinkingMessage("t-1", "Plan the change"),
      createToolCallMessage("tool-1", "Read"),
      createThinkingMessage("t-2", "Check the message renderer"),
    ] satisfies readonly DisplayMessage[]

    expect(mergeConsecutiveThinkingMessages(messages)).toEqual(messages)
  })

  it("does not merge thinking rows from different agents (different parentToolUseId)", () => {
    const agent1Thinking = {
      ...createThinkingMessage("t-1", "Let me explore the codebase"),
      parentToolUseId: "tool-agent-1",
      taskId: "task-1",
    } satisfies ThinkingDisplayMessage
    const agent2Thinking = {
      ...createThinkingMessage("t-2", "Let me explore the codebase"),
      parentToolUseId: "tool-agent-2",
      taskId: "task-2",
    } satisfies ThinkingDisplayMessage

    expect(mergeConsecutiveThinkingMessages([agent1Thinking, agent2Thinking])).toEqual([
      agent1Thinking,
      agent2Thinking,
    ])
  })

  it("still merges thinking rows from the same agent (same parentToolUseId)", () => {
    const t1 = {
      ...createThinkingMessage("t-1", "First thought"),
      parentToolUseId: "tool-agent-1",
      taskId: "task-1",
    } satisfies ThinkingDisplayMessage
    const t2 = {
      ...createThinkingMessage("t-2", "Second thought"),
      parentToolUseId: "tool-agent-1",
      taskId: "task-1",
    } satisfies ThinkingDisplayMessage

    expect(mergeConsecutiveThinkingMessages([t1, t2])).toEqual([
      {
        ...t1,
        text: "First thought\nSecond thought",
        timestamp: t2.timestamp,
        isStreaming: t2.isStreaming,
      },
    ])
  })

  it("deduplicates identical adjacent thinking rows from the same scope", () => {
    const t1 = {
      ...createThinkingMessage("t-1", "Now let me look at how slash commands are populated."),
      parentToolUseId: null,
      taskId: null,
    } satisfies ThinkingDisplayMessage
    const t2 = {
      ...createThinkingMessage("t-2", "Now let me look at how slash commands are populated."),
      parentToolUseId: null,
      taskId: null,
    } satisfies ThinkingDisplayMessage

    expect(mergeConsecutiveThinkingMessages([t1, t2])).toEqual([t1])
  })
})

describe("mergeVisibleMessages", () => {
  it("groups consecutive top-level tool rows into one visible row", () => {
    const merged = mergeVisibleMessages([
      createToolCallMessage("tool-1", "Read"),
      createToolCallMessage("tool-2", "Grep"),
      createAssistantMessage("a-1"),
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({
      kind: "tool_call_group",
      messages: [
        { toolCall: { id: "tool-1", name: "Read" } },
        { toolCall: { id: "tool-2", name: "Grep" } },
      ],
    })
    expect(merged[1]).toEqual(createAssistantMessage("a-1"))
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

  it("humanizes MCP tool names", () => {
    expect(normalizeToolLabel("mcp__morph__edit_file")).toBe("morph: edit file")
    expect(normalizeToolLabel("mcp__morph__codebase_search")).toBe("morph: codebase search")
    expect(normalizeToolLabel("mcp__github__create_issue")).toBe("github: create issue")
  })

  it("leaves non-MCP tool names unchanged", () => {
    expect(normalizeToolLabel("Bash")).toBe("Bash")
    expect(normalizeToolLabel("Read")).toBe("Read")
    expect(normalizeToolLabel("mcp_not_double_underscore")).toBe("mcp_not_double_underscore")
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

  it("only exposes inline diffs for completed tool rows", () => {
    expect(
      getToolCallDiffFileChange({
        status: "completed",
        fileChange: {
          filePath: "/tmp/example.ts",
          changeType: "modified",
          patch: "--- /tmp/example.ts\n+++ /tmp/example.ts\n",
        },
      }),
    ).toEqual({
      filePath: "/tmp/example.ts",
      changeType: "modified",
      patch: "--- /tmp/example.ts\n+++ /tmp/example.ts\n",
    })

    expect(
      getToolCallDiffFileChange({
        status: "running",
        fileChange: {
          filePath: "/tmp/example.ts",
          changeType: "modified",
          patch: "--- /tmp/example.ts\n+++ /tmp/example.ts\n",
        },
      }),
    ).toBeNull()
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

  it("formats a short task context label for scoped tool rows", () => {
    expect(
      getTaskContextLabel(
        createTask({
          taskType: "local_agent",
          description: "Inspect command routing and picker behavior",
        }),
      ),
    ).toBe("subagent: Inspect command routing and picker behavior")
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
      sectionPaddingY: 0,
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
    isStreaming: false,
    timestamp: new Date("2026-03-30T10:00:01Z"),
    taskId: null,
    parentToolUseId: null,
  }
}

function createThinkingMessage(id: string, text = "internal reasoning"): ThinkingDisplayMessage {
  return {
    kind: "thinking",
    uuid: MessageUUID(id),
    text,
    isStreaming: false,
    timestamp: new Date("2026-03-30T10:00:01Z"),
    taskId: null,
    parentToolUseId: null,
  }
}

function createToolCallMessage(id: string, name: string): DisplayMessage {
  return {
    kind: "tool_call",
    uuid: MessageUUID(`tool:${id}`),
    toolCall: createToolCall(id, name),
    timestamp: new Date("2026-03-30T10:00:01Z"),
    taskId: null,
    parentToolUseId: null,
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

function createTaskMessage(id: string): DisplayMessage {
  return {
    kind: "task",
    uuid: MessageUUID(`task:${id}`),
    task: createTask({ id, description: "Inspect repository" }),
    timestamp: new Date("2026-03-30T10:00:03Z"),
  }
}

describe("getTodoProgress", () => {
  it("identifies the first in_progress item as the active item", () => {
    const progress = getTodoProgress([
      { content: "Done", status: "completed" },
      { content: "Working", status: "in_progress", activeForm: "working on it" },
      { content: "Next", status: "pending" },
    ])

    expect(progress.completedCount).toBe(1)
    expect(progress.total).toBe(3)
    expect(progress.activeItem?.content).toBe("Working")
    expect(progress.currentIndex).toBe(1)
  })

  it("falls back to the first pending item when nothing is in_progress", () => {
    const progress = getTodoProgress([
      { content: "Done", status: "completed" },
      { content: "Pending one", status: "pending" },
      { content: "Pending two", status: "pending" },
    ])

    expect(progress.activeItem?.content).toBe("Pending one")
  })

  it("returns null activeItem and currentIndex=total when all items are completed", () => {
    const progress = getTodoProgress([
      { content: "Done one", status: "completed" },
      { content: "Done two", status: "completed" },
    ])

    expect(progress.activeItem).toBeNull()
    expect(progress.completedCount).toBe(2)
    expect(progress.currentIndex).toBe(2)
  })

  it("handles empty list gracefully", () => {
    const progress = getTodoProgress([])
    expect(progress.total).toBe(0)
    expect(progress.completedCount).toBe(0)
    expect(progress.activeItem).toBeNull()
  })
})

describe("formatTodoSummaryLine", () => {
  it("shows current/total and the active item description", () => {
    const line = formatTodoSummaryLine([
      { content: "Step one", status: "completed" },
      { content: "Step two", status: "in_progress", activeForm: "doing step two" },
      { content: "Step three", status: "pending" },
    ])

    expect(line).toBe("2/3 doing step two")
  })

  it("uses content as fallback when activeForm is absent", () => {
    const line = formatTodoSummaryLine([
      { content: "Step one", status: "completed" },
      { content: "Step two", status: "in_progress" },
    ])

    expect(line).toBe("2/2 Step two")
  })

  it("shows a done summary when all items are completed", () => {
    const line = formatTodoSummaryLine([
      { content: "A", status: "completed" },
      { content: "B", status: "completed" },
    ])

    expect(line).toBe("tasks 2/2 done")
  })

  it("returns empty string for an empty list", () => {
    expect(formatTodoSummaryLine([])).toBe("")
  })

  it("truncates long lines to maxLength", () => {
    const longActiveForm = "a".repeat(80)
    const line = formatTodoSummaryLine(
      [{ content: "Task", status: "in_progress", activeForm: longActiveForm }],
      20,
    )

    expect(line.length).toBeLessThanOrEqual(20)
    expect(line.endsWith("…")).toBe(true)
  })
})

describe("normalizeToolLabel (TodoWrite)", () => {
  it("normalizes TodoWrite to 'tasks'", () => {
    expect(normalizeToolLabel("TodoWrite")).toBe("tasks")
    expect(normalizeToolLabel("todowrite")).toBe("tasks")
    expect(normalizeToolLabel("TODOWRITE")).toBe("tasks")
  })
})

describe("getToolBriefDetail (TodoWrite)", () => {
  it("returns a todo summary for a TodoWrite tool call with a todos array input", () => {
    const detail = getToolBriefDetail({
      input: {
        todos: [
          { content: "Set up env", status: "completed" },
          { content: "Write code", status: "in_progress", activeForm: "writing code" },
          { content: "Run tests", status: "pending" },
        ],
      },
    })

    expect(detail).toBe("2/3 writing code")
  })

  it("falls back to normal key scanning for non-TodoWrite inputs", () => {
    const detail = getToolBriefDetail({
      input: { file_path: "/src/index.ts" },
    })

    expect(detail).toBe("/src/index.ts")
  })

  it("returns empty string when input has an empty todos array", () => {
    const detail = getToolBriefDetail({
      input: { todos: [] },
    })

    expect(detail).toBe("")
  })
})

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
