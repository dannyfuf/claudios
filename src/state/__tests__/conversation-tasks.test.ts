import { describe, expect, it } from "bun:test"
import type {
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SpawnedTask,
} from "#sdk/types"
import {
  isFinalTaskStatus,
  mergeTaskNotification,
  mergeTaskProgress,
  mergeTaskStarted,
} from "#state/conversation-tasks"

describe("task helpers", () => {
  it("creates a running task from a start event", () => {
    expect(mergeTaskStarted(null, createStartedMessage())).toEqual({
      id: "task-1",
      description: "Inspect slash flow",
      taskType: "local_agent",
      workflowName: null,
      toolUseId: "tool-1",
      prompt: "Inspect slash flow",
      status: "running",
      summary: null,
      lastToolName: null,
      outputFile: null,
      usage: null,
    })
  })

  it("preserves the final summary and usage when progress arrives after completion", () => {
    const completedTask: SpawnedTask = {
      id: "task-1",
      description: "Inspect slash flow",
      taskType: "local_agent",
      workflowName: null,
      toolUseId: "tool-1",
      prompt: "Inspect slash flow",
      status: "completed",
      summary: "Final summary",
      lastToolName: "Read",
      outputFile: "/tmp/task-1.md",
      usage: {
        totalTokens: 640,
        toolUses: 4,
        durationMs: 12_000,
      },
    }

    expect(mergeTaskProgress(completedTask, createProgressMessage())).toEqual(completedTask)
  })

  it("finalizes notification output and recognizes final statuses", () => {
    const task = mergeTaskNotification(
      mergeTaskStarted(null, createStartedMessage()),
      createNotificationMessage(),
    )

    expect(task).toMatchObject({
      status: "failed",
      summary: "Command failed",
      outputFile: "/tmp/task-1.md",
      usage: {
        totalTokens: 320,
        toolUses: 2,
        durationMs: 3200,
      },
    })
    expect(isFinalTaskStatus(task.status)).toBe(true)
    expect(isFinalTaskStatus("running")).toBe(false)
  })
})

function createStartedMessage(): SDKTaskStartedMessage {
  return {
    type: "system",
    subtype: "task_started",
    task_id: "task-1",
    description: "Inspect slash flow",
    task_type: "local_agent",
    tool_use_id: "tool-1",
    prompt: "Inspect slash flow",
    uuid: "11111111-1111-1111-1111-111111111111",
    session_id: "session-1",
  }
}

function createProgressMessage(): SDKTaskProgressMessage {
  return {
    type: "system",
    subtype: "task_progress",
    task_id: "task-1",
    description: "Inspect slash flow",
    tool_use_id: "tool-1",
    summary: "Intermediate summary",
    last_tool_name: "Edit",
    usage: {
      total_tokens: 128,
      tool_uses: 1,
      duration_ms: 900,
    },
    uuid: "22222222-2222-2222-2222-222222222222",
    session_id: "session-1",
  }
}

function createNotificationMessage(): SDKTaskNotificationMessage {
  return {
    type: "system",
    subtype: "task_notification",
    task_id: "task-1",
    status: "failed",
    summary: "Command failed",
    output_file: "/tmp/task-1.md",
    usage: {
      total_tokens: 320,
      tool_uses: 2,
      duration_ms: 3200,
    },
    uuid: "33333333-3333-3333-3333-333333333333",
    session_id: "session-1",
  }
}
