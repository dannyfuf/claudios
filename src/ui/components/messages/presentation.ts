import type { DisplayMessage, ThinkingDisplayMessage, ToolCallDisplayMessage } from "#state/types"
import type { ThemePalette } from "#ui/theme"
import { formatTaskKindLabel, getTaskStatusPresentation } from "#ui/components/messages/task-presentation"

export type StatusTone = "warning" | "success" | "error" | "primary"

export type MessageTier = "user" | "assistant" | "activity"

export type MessageHeaderTone = StatusTone | "muted"

export type MessageHeaderIndicator =
  | { readonly kind: "spinner"; readonly tone: StatusTone }
  | {
      readonly kind: "icon"
      readonly icon: "✓" | "✗" | "■"
      readonly tone: StatusTone
    }

export type MessageHeaderModel = {
  readonly label: string
  readonly labelEmphasis: "regular" | "strong"
  readonly labelTone: MessageHeaderTone
  readonly contextLabel: string | null
  readonly timestamp: string
  readonly indicator: MessageHeaderIndicator | null
  readonly streamingTone: MessageHeaderTone | null
}

export type MessageFrameIntent = {
  readonly alignment: "left" | "right"
  readonly width: "column" | "user"
  readonly surface:
    | "none"
    | "surface"
    | "surfaceAlt"
    | "assistantSurface"
    | "userSurface"
    | "toolSurface"
  readonly border: "subtle" | "strong" | "status" | "error"
  readonly borderTone: StatusTone | null
}

export type MessagePresentation = {
  readonly tier: MessageTier
  readonly frame: MessageFrameIntent
  readonly header: MessageHeaderModel
}

export type ToolCallGroupDisplayMessage = {
  readonly kind: "tool_call_group"
  readonly uuid: ToolCallDisplayMessage["uuid"]
  readonly messages: readonly ToolCallDisplayMessage[]
  readonly timestamp: Date
}

export type MessageRow = DisplayMessage | ToolCallGroupDisplayMessage

export type MessageLayout = {
  readonly compact: boolean
  readonly horizontalPadding: number
  readonly columnWidth: number
  readonly userBubbleWidth: number
  readonly sectionPaddingY: number
  readonly metaGapBottom: number
}

export function getMessageLayout(width: number): MessageLayout {
  const compact = width < 92
  const horizontalPadding = compact ? 1 : width < 124 ? 2 : 4
  const availableWidth = Math.max(28, width - horizontalPadding * 2)
  const columnWidth = compact ? availableWidth : Math.min(availableWidth, width >= 132 ? 104 : 92)
  const userBubbleWidth = compact
    ? Math.max(28, Math.min(columnWidth, availableWidth - 2))
    : Math.max(34, Math.min(columnWidth, Math.floor(columnWidth * 0.78)))

  return {
    compact,
    horizontalPadding,
    columnWidth,
    userBubbleWidth,
    sectionPaddingY: 0,
    metaGapBottom: compact ? 0 : 1,
  }
}

export function getMessageTier(message: DisplayMessage): MessageTier {
  switch (message.kind) {
    case "user":
      return "user"
    case "assistant":
      return "assistant"
    case "tool_call":
    case "task":
    case "thinking":
    case "system":
    case "error":
      return "activity"
  }

  return assertNever(message)
}

export function getMessageFrameIntent(message: DisplayMessage): MessageFrameIntent {
  switch (message.kind) {
    case "user":
      return {
        alignment: "right",
        width: "user",
        surface: "userSurface",
        border: "strong",
        borderTone: null,
      }
    case "tool_call":
      return {
        alignment: "left",
        width: "column",
        surface: "toolSurface",
        border: "subtle",
        borderTone: null,
      }
    case "task": {
      const statusPresentation = getTaskStatusPresentation(message.task.status)

      return {
        alignment: "left",
        width: "column",
        surface: "toolSurface",
        border: "status",
        borderTone: statusPresentation.tone,
      }
    }
    case "assistant":
      return {
        alignment: "left",
        width: "column",
        surface: "assistantSurface",
        border: "subtle",
        borderTone: null,
      }
    case "thinking":
      return {
        alignment: "left",
        width: "column",
        surface: "none",
        border: "subtle",
        borderTone: null,
      }
    case "system":
      return {
        alignment: "left",
        width: "column",
        surface: "none",
        border: "subtle",
        borderTone: null,
      }
    case "error":
      return {
        alignment: "left",
        width: "column",
        surface: "surfaceAlt",
        border: "error",
        borderTone: "error",
      }
  }

  return assertNever(message)
}

export function getMessageHeaderModel(
  message: DisplayMessage,
  contextLabel: string | null,
): MessageHeaderModel {
  switch (message.kind) {
    case "user":
      return {
        label: "you",
        labelEmphasis: "regular",
        labelTone: "muted",
        contextLabel: null,
        timestamp: formatMessageTimestamp(message.timestamp),
        indicator: null,
        streamingTone: null,
      }
    case "assistant":
      return {
        label: "claude",
        labelEmphasis: "regular",
        labelTone: "muted",
        contextLabel,
        timestamp: formatMessageTimestamp(message.timestamp),
        indicator: null,
        streamingTone: message.isStreaming ? "primary" : null,
      }
    case "thinking":
      return {
        label: "thinking",
        labelEmphasis: "regular",
        labelTone: "muted",
        contextLabel,
        timestamp: formatMessageTimestamp(message.timestamp),
        indicator: null,
        streamingTone: message.isStreaming ? "muted" : null,
      }
    case "tool_call":
      return {
        label: "tool",
        labelEmphasis: "regular",
        labelTone: "muted",
        contextLabel,
        timestamp: formatMessageTimestamp(message.timestamp),
        indicator: null,
        streamingTone: null,
      }
    case "system":
      return {
        label: "system",
        labelEmphasis: "regular",
        labelTone: "muted",
        contextLabel: null,
        timestamp: formatMessageTimestamp(message.timestamp),
        indicator: null,
        streamingTone: null,
      }
    case "task": {
      const statusPresentation = getTaskStatusPresentation(message.task.status)

      return {
        label: message.task.status,
        labelEmphasis: "strong",
        labelTone: statusPresentation.tone,
        contextLabel: formatTaskKindLabel(message.task),
        timestamp: formatMessageTimestamp(message.timestamp),
        indicator: statusPresentation,
        streamingTone: null,
      }
    }
    case "error":
      return {
        label: message.recoverable ? "error" : "fatal",
        labelEmphasis: "strong",
        labelTone: "error",
        contextLabel: null,
        timestamp: formatMessageTimestamp(message.timestamp),
        indicator: null,
        streamingTone: null,
      }
  }

  return assertNever(message)
}

export function getMessagePresentation(
  message: DisplayMessage,
  contextLabel: string | null,
): MessagePresentation {
  return {
    tier: getMessageTier(message),
    frame: getMessageFrameIntent(message),
    header: getMessageHeaderModel(message, contextLabel),
  }
}

export function formatMessageTimestamp(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

export function mergeConsecutiveThinkingMessages(
  messages: readonly DisplayMessage[],
): DisplayMessage[] {
  const merged: DisplayMessage[] = []

  for (const message of messages) {
    const previousMessage = merged.at(-1)

    if (
      message.kind !== "thinking" ||
      previousMessage?.kind !== "thinking" ||
      previousMessage.parentToolUseId !== message.parentToolUseId ||
      previousMessage.taskId !== message.taskId
    ) {
      merged.push(message)
      continue
    }

    merged[merged.length - 1] = {
      ...previousMessage,
      text: joinThinkingText(previousMessage.text, message.text),
      isStreaming: message.isStreaming,
      timestamp: message.timestamp,
      taskId: previousMessage.taskId === message.taskId ? previousMessage.taskId : null,
      parentToolUseId:
        previousMessage.parentToolUseId === message.parentToolUseId
          ? previousMessage.parentToolUseId
          : null,
    } satisfies ThinkingDisplayMessage
  }

  return merged
}

export function getFrameWidth(
  presentation: MessagePresentation,
  layout: MessageLayout,
): number | "100%" {
  return presentation.frame.width === "user" ? layout.userBubbleWidth : "100%"
}

export function getFrameBackgroundColor(
  surface: MessagePresentation["frame"]["surface"],
  theme: ThemePalette,
): string | undefined {
  switch (surface) {
    case "none":
      return undefined
    case "surface":
      return theme.surface
    case "surfaceAlt":
      return theme.surfaceAlt
    case "assistantSurface":
      return theme.assistantSurface
    case "userSurface":
      return theme.userSurface
    case "toolSurface":
      return theme.toolSurface
  }
}

export function getFrameBorderColor(
  presentation: MessagePresentation,
  theme: ThemePalette,
): string {
  switch (presentation.frame.border) {
    case "subtle":
      return theme.borderSubtle
    case "strong":
      return theme.borderStrong
    case "error":
      return theme.error
    case "status":
      return getStatusToneColor(presentation.frame.borderTone ?? "primary", theme)
  }
}

export function getStatusToneColor(
  tone: StatusTone,
  theme: ThemePalette,
): string {
  switch (tone) {
    case "warning":
      return theme.warning
    case "success":
      return theme.success
    case "error":
      return theme.error
    case "primary":
      return theme.primary
  }
}

function joinThinkingText(current: string, next: string): string {
  if (current.length === 0) {
    return next
  }

  if (next.length === 0) {
    return current
  }

  if (current === next) {
    return current
  }

  return `${current}\n${next}`
}

export function mergeVisibleMessages(messages: readonly DisplayMessage[]): MessageRow[] {
  const mergedThinkingMessages = mergeConsecutiveThinkingMessages(messages)
  const mergedRows: MessageRow[] = []

  for (const message of mergedThinkingMessages) {
    const previousRow = mergedRows.at(-1)

    if (message.kind !== "tool_call" || !isToolCallRow(previousRow)) {
      mergedRows.push(message)
      continue
    }

    const previousMessages = previousRow.kind === "tool_call_group"
      ? previousRow.messages
      : [previousRow]
    const firstPreviousMessage = previousMessages[0]

    if (!firstPreviousMessage) {
      mergedRows.push(message)
      continue
    }

    mergedRows[mergedRows.length - 1] = {
      kind: "tool_call_group",
      uuid: firstPreviousMessage.uuid,
      messages: [...previousMessages, message],
      timestamp: message.timestamp,
    }
  }

  return mergedRows
}

function isToolCallRow(
  previousRow: MessageRow | undefined,
): previousRow is ToolCallDisplayMessage | ToolCallGroupDisplayMessage {
  return previousRow?.kind === "tool_call" || previousRow?.kind === "tool_call_group"
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`)
}
