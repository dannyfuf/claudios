import { MessageUUID } from "#sdk/types"
import type { ToolCall } from "#sdk/types"

export type TranscriptBlockKind = "assistant" | "thinking"

export type AssistantBlock =
  | {
      readonly kind: "assistant"
      readonly uuid: MessageUUID
      readonly text: string
      readonly sourceIndices: readonly number[]
    }
  | {
      readonly kind: "thinking"
      readonly uuid: MessageUUID
      readonly text: string
      readonly sourceIndices: readonly number[]
    }
  | {
      readonly kind: "tool_call"
      readonly uuid: MessageUUID
      readonly toolCall: ToolCall
    }

export function extractAssistantBlocks(
  messageUuid: string,
  message: unknown,
  options: { readonly defaultToolStatus: ToolCall["status"] },
): readonly AssistantBlock[] {
  if (!isRecord(message)) {
    return []
  }

  const content = message["content"]
  if (typeof content === "string") {
    return content.length > 0
      ? [{
          kind: "assistant",
          uuid: transcriptMessageUuid("assistant", messageUuid, 0),
          text: content,
          sourceIndices: [0],
        }]
      : []
  }

  if (!Array.isArray(content)) {
    return []
  }

  const blocks: AssistantBlock[] = []

  const appendTextBlock = (
    kind: Extract<AssistantBlock, { readonly kind: TranscriptBlockKind }>["kind"],
    text: string,
    index: number,
  ) => {
    if (text.length === 0) {
      return
    }

    const previous = blocks.at(-1)
    if (previous && previous.kind === kind) {
      blocks[blocks.length - 1] = {
        ...previous,
        text: `${previous.text}${text}`,
        sourceIndices: [...previous.sourceIndices, index],
      }
      return
    }

    blocks.push({
      kind,
      uuid: transcriptMessageUuid(kind, messageUuid, index),
      text,
      sourceIndices: [index],
    })
  }

  for (const [index, block] of content.entries()) {
    if (typeof block === "string") {
      appendTextBlock("assistant", block, index)
      continue
    }

    if (!isRecord(block)) {
      continue
    }

    const type = block["type"]
    if (type === "text" && typeof block["text"] === "string" && block["text"].length > 0) {
      appendTextBlock("assistant", block["text"], index)
      continue
    }

    if (
      type === "thinking"
      && typeof block["thinking"] === "string"
      && block["thinking"].length > 0
    ) {
      appendTextBlock("thinking", block["thinking"], index)
      continue
    }

    if (
      (type === "tool_use" || type === "server_tool_use")
      && typeof block["id"] === "string"
      && typeof block["name"] === "string"
    ) {
      blocks.push({
        kind: "tool_call",
        uuid: toolCallMessageUuid(block["id"]),
        toolCall: {
          id: block["id"],
          name: block["name"],
          input: isRecord(block["input"]) ? block["input"] : {},
          status: options.defaultToolStatus,
          output: null,
          elapsedSeconds: null,
        },
      })
    }
  }

  return blocks
}

export function extractTextContent(message: unknown): string {
  if (!isRecord(message)) {
    return ""
  }

  const content = message["content"]
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .flatMap((block) => {
      if (typeof block === "string") {
        return [block]
      }

      if (isRecord(block) && typeof block["text"] === "string") {
        return [block["text"]]
      }

      return []
    })
    .join("")
}

export function transcriptMessageUuid(
  kind: TranscriptBlockKind,
  messageUuid: string,
  blockIndex: number,
): MessageUUID {
  return MessageUUID(`${kind}:${messageUuid}:${blockIndex}`)
}

export function toolCallMessageUuid(toolUseId: string): MessageUUID {
  return MessageUUID(`tool:${toolUseId}`)
}

export function getStreamingBlockKey(messageUuid: string, blockIndex: number): string {
  return `${messageUuid}:${blockIndex}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
