import type { MessageUUID, ToolCall } from "#sdk/types"
import type { AssistantDisplayMessage, ThinkingDisplayMessage } from "#state/types"
import {
  getStreamingBlockKey,
  transcriptMessageUuid,
  type AssistantBlock,
  type TranscriptBlockKind,
} from "#state/conversation-transcript"

export type MessageScope = {
  readonly taskId: string | null
  readonly parentToolUseId: string | null
}

export type StreamingBlockKind = TranscriptBlockKind

export type StreamingBlockState = {
  readonly rowUuid: MessageUUID
  readonly kind: StreamingBlockKind
  readonly text: string
  readonly scope: MessageScope
}

export type SDKMessageContext = {
  readonly streamingBlocks: Map<string, StreamingBlockState>
}

export type TranscriptTextMessage = AssistantDisplayMessage | ThinkingDisplayMessage

export type TranscriptTextMessageInput = {
  readonly kind: StreamingBlockKind
  readonly uuid: MessageUUID
  readonly text: string
  readonly isStreaming: boolean
  readonly timestamp: Date
  readonly scope: MessageScope
}

type FinalizedToolCallStatus = Exclude<ToolCall["status"], "running">

type StreamingDependencies = {
  readonly finalizeRunningToolCallsForScope: (
    scope: MessageScope,
    status: FinalizedToolCallStatus,
  ) => void
  readonly getLatestReusableTranscriptTextMessage: (
    kind: StreamingBlockKind,
    scope: MessageScope,
  ) => TranscriptTextMessage | null
  readonly getTranscriptTextMessage: (uuid: MessageUUID) => TranscriptTextMessage | null
  readonly setMessageStreaming: (uuid: MessageUUID, isStreaming: boolean) => void
  readonly upsertTranscriptTextMessage: (options: TranscriptTextMessageInput) => void
}

export function createSDKMessageContext(): SDKMessageContext {
  return {
    streamingBlocks: new Map(),
  }
}

export function startStreamingTranscriptBlock(
  dependencies: StreamingDependencies,
  input: {
    readonly messageUuid: string
    readonly blockIndex: number
    readonly kind: StreamingBlockKind
    readonly initialText: string
    readonly scope: MessageScope
    readonly timestamp: Date
    readonly ctx: SDKMessageContext
  },
): void {
  const key = getStreamingBlockKey(input.messageUuid, input.blockIndex)
  const existing = input.ctx.streamingBlocks.get(key)
  if (!existing) {
    dependencies.finalizeRunningToolCallsForScope(input.scope, "completed")
  }

  const reusableMessage = existing
    ? null
    : dependencies.getLatestReusableTranscriptTextMessage(input.kind, input.scope)
  const rowUuid =
    existing?.rowUuid
    ?? reusableMessage?.uuid
    ?? transcriptMessageUuid(input.kind, input.messageUuid, input.blockIndex)
  const nextText = `${existing?.text ?? reusableMessage?.text ?? ""}${input.initialText}`

    input.ctx.streamingBlocks.set(key, {
      rowUuid,
      kind: input.kind,
      text: nextText,
      scope: input.scope,
    })

  if (nextText.length > 0) {
    dependencies.upsertTranscriptTextMessage({
      kind: input.kind,
      uuid: rowUuid,
      text: nextText,
      isStreaming: true,
      timestamp: input.timestamp,
      scope: input.scope,
    })
  }
}

export function appendStreamingTranscriptDelta(
  dependencies: StreamingDependencies,
  input: {
    readonly messageUuid: string
    readonly blockIndex: number
    readonly kind: StreamingBlockKind
    readonly deltaText: string
    readonly scope: MessageScope
    readonly timestamp: Date
    readonly ctx: SDKMessageContext
  },
): void {
  const key = getStreamingBlockKey(input.messageUuid, input.blockIndex)
  const existing = input.ctx.streamingBlocks.get(key)
  if (!existing) {
    dependencies.finalizeRunningToolCallsForScope(input.scope, "completed")
  }

  const reusableMessage = existing
    ? null
    : dependencies.getLatestReusableTranscriptTextMessage(input.kind, input.scope)
  const rowUuid =
    existing?.rowUuid
    ?? reusableMessage?.uuid
    ?? transcriptMessageUuid(input.kind, input.messageUuid, input.blockIndex)
  const nextText = `${existing?.text ?? reusableMessage?.text ?? ""}${input.deltaText}`

  input.ctx.streamingBlocks.set(key, {
    rowUuid,
    kind: input.kind,
    text: nextText,
    scope: input.scope,
  })

  if (nextText.length > 0) {
    dependencies.upsertTranscriptTextMessage({
      kind: input.kind,
      uuid: rowUuid,
      text: nextText,
      isStreaming: true,
      timestamp: input.timestamp,
      scope: input.scope,
    })
  }
}

export function stopStreamingTranscriptBlock(
  dependencies: StreamingDependencies,
  input: {
    readonly messageUuid: string
    readonly blockIndex: number
    readonly streamingBlocks: Map<string, StreamingBlockState>
  },
): void {
  const key = getStreamingBlockKey(input.messageUuid, input.blockIndex)
  const existing = input.streamingBlocks.get(key)
  if (!existing) {
    return
  }

  const message = dependencies.getTranscriptTextMessage(existing.rowUuid)
  if (message?.isStreaming) {
    dependencies.setMessageStreaming(existing.rowUuid, false)
  }
}

export function finalizeStreamingBlocksForMessage(
  dependencies: StreamingDependencies,
  input: {
    readonly messageUuid: string
    readonly finalizedRowUuids?: ReadonlySet<MessageUUID>
    readonly streamingBlocks: Map<string, StreamingBlockState>
  },
): void {
  for (const [key, block] of input.streamingBlocks.entries()) {
    const matchesMessageUuid = key.startsWith(`${input.messageUuid}:`)
    const matchesFinalizedRow = input.finalizedRowUuids?.has(block.rowUuid) ?? false

    if (!matchesMessageUuid && !matchesFinalizedRow) {
      continue
    }

    const message = dependencies.getTranscriptTextMessage(block.rowUuid)
    if (message?.isStreaming) {
      dependencies.setMessageStreaming(block.rowUuid, false)
    }

    input.streamingBlocks.delete(key)
  }
}

export function resolveTranscriptBlockUuid(
  messageUuid: string,
  block: Extract<AssistantBlock, { readonly kind: "assistant" | "thinking" }>,
  ctx: SDKMessageContext,
  scope?: MessageScope,
): MessageUUID {
  for (const index of block.sourceIndices) {
    const existing = ctx.streamingBlocks.get(getStreamingBlockKey(messageUuid, index))
    if (existing) {
      return existing.rowUuid
    }
  }

  if (scope) {
    const matchingBlocks = [...ctx.streamingBlocks.values()].filter((existing) =>
      existing.kind === block.kind
      && existing.scope.taskId === scope.taskId
      && existing.scope.parentToolUseId === scope.parentToolUseId
      && existing.text === block.text,
    )

    const matchingBlock = matchingBlocks[0]
    if (matchingBlock && matchingBlocks.length === 1) {
      return matchingBlock.rowUuid
    }
  }

  return block.uuid
}
