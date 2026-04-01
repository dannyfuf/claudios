/**
 * MessageArea — the scrollable message display in the center zone.
 *
 * Renders user messages, assistant markdown (with streaming), tool calls,
 * system messages, spawned task activity, and error blocks.
 */

import { useMemo, type RefObject } from "react"
import { ScrollBoxRenderable, SyntaxStyle } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { DisplayMessage, TaskDisplayMessage, ToolCallDisplayMessage } from "#state/types"
import {
  getMessageLayout,
  getMessagePresentation,
  getTaskContextLabel,
  mergeVisibleMessages,
  type MessageRow,
} from "#ui/components/MessageArea.logic"
import { EmptyState } from "#ui/components/messages/EmptyState"
import { TaskMessage } from "#ui/components/messages/TaskMessage"
import {
  AssistantMessage,
  ErrorMessage,
  SystemMessage,
  ThinkingMessage,
  UserMessage,
} from "#ui/components/messages/TextMessageBlocks"
import { GroupedToolCallMessage, ToolCallMessage } from "#ui/components/messages/ToolCallMessage"
import { useConversationState, useThemePalette } from "#ui/hooks"

type MessageAreaProps = {
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>
}

export function MessageArea(props: MessageAreaProps) {
  const theme = useThemePalette()
  const state = useConversationState()
  const { width } = useTerminalDimensions()
  const { messages, startup, showThinking, diffMode } = state
  const layout = useMemo(() => getMessageLayout(width), [width])
  const syntaxStyle = useMemo(() => SyntaxStyle.create(), [])

  const activeTaskToolCallsByTaskId = useMemo(() => {
    const next = new Map<string, ToolCallDisplayMessage["toolCall"][]>()

    for (const message of messages) {
      if (
        message.kind !== "tool_call"
        || message.taskId === null
        || message.toolCall.status !== "running"
      ) {
        continue
      }

      const current = next.get(message.taskId) ?? []
      next.set(message.taskId, [...current, message.toolCall].slice(-2))
    }

    return next
  }, [messages])

  const taskOwnedToolUseIds = useMemo(() => {
    const next = new Set<string>()

    for (const message of messages) {
      if (message.kind === "task" && message.task.toolUseId) {
        next.add(message.task.toolUseId)
      }
    }

    return next
  }, [messages])

  const visibleMessages = useMemo(
    () =>
      mergeVisibleMessages(
        messages.filter((message) => {
          if (!showThinking && message.kind === "thinking") {
            return false
          }

          if (
            message.kind === "tool_call"
            && (
              message.taskId !== null
              || message.parentToolUseId !== null
              || taskOwnedToolUseIds.has(message.toolCall.id)
            )
          ) {
            return false
          }

          return true
        }),
      ),
    [messages, showThinking, taskOwnedToolUseIds],
  )

  const taskMessagesById = useMemo(() => {
    const next = new Map<string, TaskDisplayMessage>()

    for (const message of messages) {
      if (message.kind === "task") {
        next.set(message.task.id, message)
      }
    }

    return next
  }, [messages])

  const taskMessagesByToolUseId = useMemo(() => {
    const next = new Map<string, TaskDisplayMessage>()

    for (const message of messages) {
      if (message.kind === "task" && message.task.toolUseId) {
        next.set(message.task.toolUseId, message)
      }
    }

    return next
  }, [messages])

  return (
    <scrollbox ref={props.scrollRef} height="100%" stickyScroll stickyStart="bottom">
      {messages.length === 0 ? (
        <EmptyState layout={layout} startup={startup} theme={theme} />
      ) : (
        visibleMessages.map((message, index) => (
          <MessageBlock
            key={message.uuid ?? String(index)}
            message={message}
            syntaxStyle={syntaxStyle}
            theme={theme}
            layout={layout}
            taskContextLabel={resolveTaskContextLabel(
              message.kind === "tool_call_group" ? message.messages[0] ?? null : message,
              taskMessagesById,
              taskMessagesByToolUseId,
            )}
            activeTaskToolCalls={activeTaskToolCallsByTaskId}
            diffMode={diffMode}
          />
        ))
      )}
    </scrollbox>
  )
}

function resolveTaskContextLabel(
  message: DisplayMessage | null,
  taskMessagesById: ReadonlyMap<string, TaskDisplayMessage>,
  taskMessagesByToolUseId: ReadonlyMap<string, TaskDisplayMessage>,
): string | null {
  if (!message) {
    return null
  }

  if (
    message.kind !== "assistant"
    && message.kind !== "thinking"
    && message.kind !== "tool_call"
  ) {
    return null
  }

  const taskMessage = message.taskId
    ? taskMessagesById.get(message.taskId) ?? null
    : message.parentToolUseId
      ? taskMessagesByToolUseId.get(message.parentToolUseId) ?? null
      : null

  return taskMessage ? getTaskContextLabel(taskMessage.task) : null
}

function MessageBlock({
  message,
  syntaxStyle,
  theme,
  layout,
  taskContextLabel,
  activeTaskToolCalls,
  diffMode,
}: {
  readonly message: MessageRow
  readonly syntaxStyle: SyntaxStyle
  readonly theme: ReturnType<typeof useThemePalette>
  readonly layout: ReturnType<typeof getMessageLayout>
  readonly taskContextLabel: string | null
  readonly activeTaskToolCalls: ReadonlyMap<string, readonly ToolCallDisplayMessage["toolCall"][]>
  readonly diffMode: "unified" | "split"
}) {
  const presentationSourceMessage =
    message.kind === "tool_call_group" ? message.messages[0] ?? null : message

  if (!presentationSourceMessage) {
    return null
  }

  const presentation = getMessagePresentation(
    presentationSourceMessage,
    taskContextLabel,
  )

  switch (message.kind) {
    case "user":
      return <UserMessage message={message} presentation={presentation} theme={theme} layout={layout} />
    case "assistant":
      return (
        <AssistantMessage
          message={message}
          presentation={presentation}
          syntaxStyle={syntaxStyle}
          theme={theme}
          layout={layout}
        />
      )
    case "thinking":
      return (
        <ThinkingMessage
          message={message}
          presentation={presentation}
          theme={theme}
          layout={layout}
        />
      )
    case "tool_call":
      return (
        <ToolCallMessage
          message={message}
          presentation={presentation}
          syntaxStyle={syntaxStyle}
          theme={theme}
          layout={layout}
          diffMode={diffMode}
        />
      )
    case "tool_call_group":
      return (
        <GroupedToolCallMessage
          messages={message.messages}
          presentation={presentation}
          syntaxStyle={syntaxStyle}
          theme={theme}
          layout={layout}
          diffMode={diffMode}
        />
      )
    case "system":
      return <SystemMessage message={message} presentation={presentation} theme={theme} layout={layout} />
    case "task":
      return (
        <TaskMessage
          message={message}
          presentation={presentation}
          theme={theme}
          layout={layout}
          activeToolCalls={activeTaskToolCalls.get(message.task.id) ?? []}
        />
      )
    case "error":
      return <ErrorMessage message={message} presentation={presentation} theme={theme} layout={layout} />
  }
}
