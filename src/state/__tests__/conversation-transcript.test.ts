import { describe, expect, it } from "bun:test"
import { MessageUUID } from "#sdk/types"
import {
  extractAssistantBlocks,
  extractTextContent,
  getStreamingBlockKey,
  toolCallMessageUuid,
  transcriptMessageUuid,
} from "#state/conversation-transcript"

describe("extractAssistantBlocks", () => {
  it("merges adjacent text blocks and preserves tool calls", () => {
    const blocks = extractAssistantBlocks(
      "msg-1",
      {
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
          { type: "thinking", thinking: "Plan " },
          { type: "thinking", thinking: "more" },
          { type: "tool_use", id: "tool-1", name: "Read", input: { path: "README.md" } },
        ],
      },
      { defaultToolStatus: "running" },
    )

    expect(blocks).toEqual([
      {
        kind: "assistant",
        uuid: MessageUUID("assistant:msg-1:0"),
        text: "Hello world",
        sourceIndices: [0, 1],
      },
      {
        kind: "thinking",
        uuid: MessageUUID("thinking:msg-1:2"),
        text: "Plan more",
        sourceIndices: [2, 3],
      },
      {
        kind: "tool_call",
        uuid: MessageUUID("tool:tool-1"),
        toolCall: {
          id: "tool-1",
          name: "Read",
          input: { path: "README.md" },
          status: "running",
          output: null,
          elapsedSeconds: null,
        },
      },
    ])
  })
})

describe("transcript helpers", () => {
  it("extracts text content and stable helper keys", () => {
    expect(
      extractTextContent({
        content: ["Hello", { text: " world" }, { type: "thinking", thinking: "ignore me" }],
      }),
    ).toBe("Hello world")
    expect(transcriptMessageUuid("assistant", "msg-2", 3)).toBe(MessageUUID("assistant:msg-2:3"))
    expect(toolCallMessageUuid("tool-7")).toBe(MessageUUID("tool:tool-7"))
    expect(getStreamingBlockKey("msg-2", 3)).toBe("msg-2:3")
  })
})
