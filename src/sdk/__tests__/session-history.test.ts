import { describe, expect, it } from "bun:test"
import { coalesceSessionMessages, getSessionMessageFragmentCount } from "#sdk/session-history"

describe("session-history helpers", () => {
  it("coalesces consecutive assistant fragments that share one Claude message id", () => {
    const messages = coalesceSessionMessages([
      createAssistantFragment({
        uuid: "assistant-1",
        messageId: "msg-1",
        content: [{ type: "text", text: "Hello" }],
      }),
      createAssistantFragment({
        uuid: "assistant-2",
        messageId: "msg-1",
        content: [{ type: "text", text: " world" }],
      }),
    ])

    expect(messages).toHaveLength(1)
    expect(getUuid(messages[0])).toBe("assistant-1")
    expect(getSessionMessageFragmentCount(messages[0])).toBe(2)
    expect(getContent(messages[0])).toEqual([
      { type: "text", text: "Hello" },
      { type: "text", text: " world" },
    ])
  })

  it("defaults fragment count to one for untouched history rows", () => {
    expect(getSessionMessageFragmentCount({ type: "assistant", uuid: "assistant-1" })).toBe(1)
    expect(getSessionMessageFragmentCount(null)).toBe(1)
  })

  it("preserves block order when a thinking fragment is followed by final text", () => {
    const messages = coalesceSessionMessages([
      createAssistantFragment({
        uuid: "assistant-1",
        messageId: "msg-1",
        content: [{ type: "thinking", thinking: "Plan the answer" }],
      }),
      createAssistantFragment({
        uuid: "assistant-2",
        messageId: "msg-1",
        content: [{ type: "text", text: "Here is the answer." }],
      }),
    ])

    expect(messages).toHaveLength(1)
    expect(getContent(messages[0])).toEqual([
      { type: "thinking", thinking: "Plan the answer" },
      { type: "text", text: "Here is the answer." },
    ])
  })

  it("does not merge assistant fragments across an intervening message", () => {
    const messages = coalesceSessionMessages([
      createAssistantFragment({
        uuid: "assistant-1",
        messageId: "msg-1",
        content: [{ type: "text", text: "Hello" }],
      }),
      { type: "user", uuid: "user-1", message: { content: "interrupt" } },
      createAssistantFragment({
        uuid: "assistant-2",
        messageId: "msg-1",
        content: [{ type: "text", text: " world" }],
      }),
    ])

    expect(messages).toHaveLength(3)
  })
})

function createAssistantFragment(options: {
  readonly uuid: string
  readonly messageId: string
  readonly content: unknown
}): unknown {
  return {
    type: "assistant",
    uuid: options.uuid,
    session_id: "session-1",
    parent_tool_use_id: null,
    message: {
      id: options.messageId,
      role: "assistant",
      content: options.content,
    },
  }
}

function getUuid(message: unknown): string | null {
  if (!isRecord(message)) {
    return null
  }

  const uuid = message["uuid"]
  return typeof uuid === "string" ? uuid : null
}

function getContent(message: unknown): unknown {
  if (!isRecord(message)) {
    return null
  }

  const assistantMessage = message["message"]
  if (!isRecord(assistantMessage)) {
    return null
  }

  return assistantMessage["content"] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
