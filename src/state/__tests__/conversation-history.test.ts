import { describe, expect, it } from "bun:test"
import { coalesceSessionMessages } from "#sdk/session-history"
import type { ToolCallDisplayMessage } from "#state/types"
import { projectSessionHistory } from "#state/conversation-history"

describe("projectSessionHistory", () => {
  it("replays tool results into existing tool rows without adding a user bubble", () => {
    const state = projectSessionHistory([
      {
        type: "assistant",
        uuid: "assistant-1",
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-edit-1",
              name: "Edit",
              input: { file_path: "src/demo.ts" },
            },
          ],
        },
      },
      createUserToolResultMessage({
        uuid: "user-tool-result-1",
        toolUseIds: ["tool-edit-1"],
        toolUseResult: {
          filePath: "src/demo.ts",
          originalFile: "old\n",
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ["-old", "+new"],
            },
          ],
        },
      }),
    ])

    expect(state.messages).toHaveLength(1)

    const toolMessage = state.messages[0] as ToolCallDisplayMessage
    expect(toolMessage.toolCall.status).toBe("completed")
    expect(toolMessage.toolCall.fileChange).toEqual({
      filePath: "src/demo.ts",
      changeType: "modified",
      patch: "--- src/demo.ts\n+++ src/demo.ts\n@@ -1 +1 @@\n-old\n+new\n",
    })
  })

  it("skips historical thinking fragments once a completed assistant reply exists", () => {
    const state = projectSessionHistory(
      coalesceSessionMessages([
        {
          type: "assistant",
          uuid: "assistant-1",
          parent_tool_use_id: null,
          message: {
            id: "msg-1",
            content: [{ type: "thinking", thinking: "Plan the answer" }],
          },
        },
        {
          type: "assistant",
          uuid: "assistant-2",
          parent_tool_use_id: null,
          message: {
            id: "msg-1",
            content: [{ type: "text", text: "Here is the answer." }],
          },
        },
      ]),
    )

    expect(state.messages).toMatchObject([
      {
        kind: "assistant",
        text: "Here is the answer.",
      },
    ])
  })
})

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
