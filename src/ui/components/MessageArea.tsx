/**
 * MessageArea — the scrollable message display in the center zone.
 *
 * Renders user messages, assistant markdown (with streaming), tool calls,
 * system messages, spawned task activity, and error blocks.
 */

import { useMemo, type RefObject } from "react"
import { ScrollBoxRenderable, SyntaxStyle } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useConversationState, useThemePalette } from "#ui/hooks"
import { MessageFrame } from "#ui/components/messages/MessageFrame"
import { MessageHeader } from "#ui/components/messages/MessageHeader"
import type {
  DisplayMessage,
  UserDisplayMessage,
  AssistantDisplayMessage,
  ThinkingDisplayMessage,
  ToolCallDisplayMessage,
  SystemDisplayMessage,
  TaskDisplayMessage,
  ErrorDisplayMessage,
  StartupState,
} from "#state/types"
import {
  getToolCallDiffFileChange,
  getTaskContextLabel,
  formatTaskUsage,
  getMessageLayout,
  getMessagePresentation,
  getTaskDetailLine,
  getToolBriefDetail,
  getToolStatusPresentation,
  mergeConsecutiveThinkingMessages,
  normalizeToolLabel,
  type StatusTone,
  type MessagePresentation,
  type MessageLayout,
} from "#ui/components/MessageArea.logic"
import { LoadingIndicator } from "#ui/components/LoadingIndicator"
import type { ThemePalette } from "#ui/theme"

type MessageAreaProps = {
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>
}

export function MessageArea(props: MessageAreaProps) {
  const theme = useThemePalette()
  const state = useConversationState()
  const { width } = useTerminalDimensions()
  const { messages, startup, showThinking, diffMode } = state
  const layout = useMemo(() => getMessageLayout(width), [width])
  const activeTaskToolCallsByTaskId = useMemo(() => {
    const next = new Map<string, ToolCallDisplayMessage["toolCall"][]>()

    for (const message of messages) {
      if (
        message.kind !== "tool_call" ||
        message.taskId === null ||
        message.toolCall.status !== "running"
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
      mergeConsecutiveThinkingMessages(
        messages.filter((message) => {
          if (!showThinking && message.kind === "thinking") {
            return false
          }

          if (
            message.kind === "tool_call" &&
            (
              message.taskId !== null ||
              message.parentToolUseId !== null ||
              taskOwnedToolUseIds.has(message.toolCall.id)
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

  // Create a shared SyntaxStyle for all markdown blocks.
  const syntaxStyle = useMemo(() => SyntaxStyle.create(), [])

  return (
    <scrollbox ref={props.scrollRef} height="100%" stickyScroll stickyStart="bottom">
      {messages.length === 0 ? (
        <EmptyState layout={layout} startup={startup} theme={theme} />
      ) : (
        visibleMessages.map((msg, i) => {
          return (
            <MessageBlock
              key={msg.uuid ?? String(i)}
              message={msg}
              syntaxStyle={syntaxStyle}
              theme={theme}
              layout={layout}
              taskContextLabel={resolveTaskContextLabel(
                msg,
                taskMessagesById,
                taskMessagesByToolUseId,
              )}
              activeTaskToolCalls={activeTaskToolCallsByTaskId}
              diffMode={diffMode}
            />
          )
        })
      )}
    </scrollbox>
  )
}

function EmptyState({
  layout,
  startup,
  theme,
}: {
  layout: MessageLayout
  startup: StartupState
  theme: ReturnType<typeof useThemePalette>
}) {
  const content = getEmptyStateContent(startup, theme)

  return (
    <box
      paddingX={layout.horizontalPadding}
      paddingY={layout.compact ? 1 : 2}
      alignItems="center"
      flexGrow={1}
      justifyContent="center"
    >
      <box
        width="100%"
        maxWidth={layout.columnWidth}
        flexDirection="column"
        alignItems="center"
        paddingX={layout.compact ? 0 : 1}
      >
        <box flexDirection="row" gap={1} marginBottom={1} alignItems="center">
          {content.showSpinner ? <LoadingIndicator color={content.badgeTextColor} /> : null}
          <text>
            <span fg={content.badgeTextColor}>
              <strong>{content.badge.toLowerCase()}</strong>
            </span>
          </text>
          <text>
            <span fg={theme.mutedText}>{content.context}</span>
          </text>
        </box>
        <text>
          <span fg={theme.text}>{content.title}</span>
        </text>
        <box marginTop={1}>
          <text>
            <span fg={theme.mutedText}>{content.description}</span>
          </text>
        </box>
        {content.rows.length > 0 ? (
          <box marginTop={1} flexDirection="column" alignItems="center">
            {content.rows.map((row) => (
              <text key={row}>
                <span fg={theme.mutedText}>{row}</span>
              </text>
            ))}
          </box>
        ) : null}
      </box>
    </box>
  )
}

function getEmptyStateContent(
  startup: StartupState,
  theme: ReturnType<typeof useThemePalette>,
): {
  readonly badge: string
  readonly badgeTextColor: string
  readonly context: string
  readonly title: string
  readonly description: string
  readonly rows: readonly string[]
  readonly showSpinner: boolean
} {
  if (startup.auth.status === "failed") {
    return {
      badge: "auth required",
      badgeTextColor: theme.error,
      context: "startup blocked",
      title: "Claude Code needs authentication.",
      description: startup.auth.message,
      rows: ["Run `claude auth login`, then restart claudios."],
      showSpinner: false,
    }
  }

  if (startup.resume.status === "failed") {
    return {
      badge: "resume failed",
      badgeTextColor: theme.warning,
      context: "fresh chat ready",
      title: "The saved session could not be restored.",
      description: startup.resume.message,
      rows: ["You can start a fresh conversation immediately or open another session."],
      showSpinner: false,
    }
  }

  if (startup.auth.status === "loading" || startup.resume.status === "loading") {
    const rows = [
      startup.auth.status === "loading"
        ? "[1/2] Checking Claude Code authentication"
        : "[1/2] Claude Code authentication ready",
      startup.resume.status === "loading"
        ? "[2/2] Restoring saved session history"
        : "[2/2] Conversation shell ready",
      "Type now if you want; sending unlocks automatically when startup finishes",
    ]

    return {
      badge: "starting",
      badgeTextColor: theme.primary,
      context: startup.resume.status === "loading" ? "resuming session" : "connecting",
      title: "Booting the chat shell.",
      description: "The interface is live. Background startup work continues behind this placeholder.",
      rows,
      showSpinner: true,
    }
  }

  return {
    badge: "ready",
    badgeTextColor: theme.primary,
    context: "conversation shell",
    title: "Start a conversation.",
    description: "Ask Claude a question, run a command, or open /sessions to continue a thread.",
    rows: [],
    showSpinner: false,
  }
}

function resolveTaskContextLabel(
  message: DisplayMessage,
  taskMessagesById: ReadonlyMap<string, TaskDisplayMessage>,
  taskMessagesByToolUseId: ReadonlyMap<string, TaskDisplayMessage>,
): string | null {
  if (
    message.kind !== "assistant" &&
    message.kind !== "thinking" &&
    message.kind !== "tool_call"
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
  message: DisplayMessage
  syntaxStyle: SyntaxStyle
  theme: ThemePalette
  layout: MessageLayout
  taskContextLabel: string | null
  activeTaskToolCalls: ReadonlyMap<string, readonly ToolCallDisplayMessage["toolCall"][]>
  diffMode: "unified" | "split"
}) {
  const presentation = getMessagePresentation(message, taskContextLabel)

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

function UserMessage({
  message,
  presentation,
  theme,
  layout,
}: {
  message: UserDisplayMessage
  presentation: MessagePresentation
  theme: ThemePalette
  layout: MessageLayout
}) {
  return (
    <MessageFrame
      align={presentation.frame.alignment}
      backgroundColor={getFrameBackgroundColor(presentation.frame.surface, theme)}
      borderColor={getFrameBorderColor(presentation, theme)}
      horizontalPadding={layout.horizontalPadding}
      maxWidth={layout.columnWidth}
      paddingX={layout.compact ? 1 : 2}
      paddingY={layout.sectionPaddingY}
      width={getFrameWidth(presentation, layout)}
    >
      <MessageHeader
        compact={layout.compact}
        marginBottom={layout.metaGapBottom}
        model={presentation.header}
        theme={theme}
      />
      <text>
        <span fg={theme.text}>{message.text}</span>
      </text>
    </MessageFrame>
  )
}

function AssistantMessage({
  message,
  presentation,
  syntaxStyle,
  theme,
  layout,
}: {
  message: AssistantDisplayMessage
  presentation: MessagePresentation
  syntaxStyle: SyntaxStyle
  theme: ThemePalette
  layout: MessageLayout
}) {
  const hasText = message.text.trim().length > 0

  return (
    <MessageFrame
      align={presentation.frame.alignment}
      backgroundColor={getFrameBackgroundColor(presentation.frame.surface, theme)}
      borderColor={getFrameBorderColor(presentation, theme)}
      horizontalPadding={layout.horizontalPadding}
      maxWidth={layout.columnWidth}
      paddingX={1}
      paddingY={layout.sectionPaddingY}
      width={getFrameWidth(presentation, layout)}
    >
      <MessageHeader
        compact={layout.compact}
        marginBottom={hasText ? layout.metaGapBottom : 0}
        model={presentation.header}
        theme={theme}
      />
      {hasText ? (
        <box>
          <markdown
            content={message.text}
            streaming={message.isStreaming}
            syntaxStyle={syntaxStyle}
          />
        </box>
      ) : null}
    </MessageFrame>
  )
}

function ThinkingMessage({
  message,
  presentation,
  theme,
  layout,
}: {
  message: ThinkingDisplayMessage
  presentation: MessagePresentation
  theme: ThemePalette
  layout: MessageLayout
}) {
  const thinkingLines = message.text.split("\n")

  return (
    <MessageFrame
      align={presentation.frame.alignment}
      backgroundColor={getFrameBackgroundColor(presentation.frame.surface, theme)}
      borderColor={getFrameBorderColor(presentation, theme)}
      horizontalPadding={layout.horizontalPadding}
      maxWidth={layout.columnWidth}
      paddingX={1}
      paddingY={layout.sectionPaddingY}
      width={getFrameWidth(presentation, layout)}
    >
      <MessageHeader
        compact={layout.compact}
        marginBottom={layout.metaGapBottom}
        model={presentation.header}
        theme={theme}
      />
      <box paddingLeft={layout.compact ? 1 : 2} flexDirection="column">
        {thinkingLines.map((line, index) => (
          <text key={`${message.uuid}:${index}`}>
            <span fg={theme.mutedText}>
              <em>{line}</em>
            </span>
          </text>
        ))}
      </box>
    </MessageFrame>
  )
}

function ToolCallMessage({
  message,
  presentation,
  syntaxStyle,
  theme,
  layout,
  diffMode,
}: {
  message: ToolCallDisplayMessage
  presentation: MessagePresentation
  syntaxStyle: SyntaxStyle
  theme: ThemePalette
  layout: MessageLayout
  diffMode: "unified" | "split"
}) {
  const fileChange = getToolCallDiffFileChange(message.toolCall)

  return (
    <MessageFrame
      align={presentation.frame.alignment}
      backgroundColor={getFrameBackgroundColor(presentation.frame.surface, theme)}
      borderColor={getFrameBorderColor(presentation, theme)}
      horizontalPadding={layout.horizontalPadding}
      maxWidth={layout.columnWidth}
      paddingX={1}
      paddingY={layout.sectionPaddingY}
      width={getFrameWidth(presentation, layout)}
    >
      <MessageHeader
        compact={layout.compact}
        marginBottom={layout.metaGapBottom}
        model={presentation.header}
        theme={theme}
      />
      <CompactToolRow toolCall={message.toolCall} theme={theme} />
      {fileChange ? (
        <box marginTop={1} flexDirection="column">
          <text>
            <span fg={theme.mutedText}>
              {fileChange.changeType === "added" ? "created" : "modified"} {fileChange.filePath}
            </span>
          </text>
          <box marginTop={1} width="100%">
            <diff
              diff={fileChange.patch}
              view={diffMode}
              showLineNumbers={true}
              syntaxStyle={syntaxStyle}
              wrapMode="none"
            />
          </box>
        </box>
      ) : null}
    </MessageFrame>
  )
}

/**
 * Single-line tool call row: status icon + tool name + brief detail.
 */
function CompactToolRow({
  toolCall,
  theme,
}: {
  toolCall: ToolCallDisplayMessage["toolCall"]
  theme: ThemePalette
}) {
  const statusPresentation = getToolStatusPresentation(toolCall.status)
  const statusColor = getStatusToneColor(statusPresentation.tone, theme)
  const detail = getToolBriefDetail(toolCall)
  const label = normalizeToolLabel(toolCall.name)

  return (
    <box flexDirection="row" gap={1}>
      <box width={1} minWidth={1} alignItems="center" justifyContent="center">
        {statusPresentation.kind === "spinner" ? (
          <LoadingIndicator color={statusColor} />
        ) : (
          <text>
            <span fg={statusColor}>{statusPresentation.icon}</span>
          </text>
        )}
      </box>
      <text>
        <span fg={theme.text}>{label}</span>
      </text>
      {detail ? (
        <text>
          <span fg={theme.mutedText}>- {detail}</span>
        </text>
      ) : null}
      {toolCall.elapsedSeconds !== null ? (
        <text>
          <span fg={theme.mutedText}>{toolCall.elapsedSeconds.toFixed(1)}s</span>
        </text>
      ) : null}
    </box>
  )
}

function SystemMessage({
  message,
  presentation,
  theme,
  layout,
}: {
  message: SystemDisplayMessage
  presentation: MessagePresentation
  theme: ThemePalette
  layout: MessageLayout
}) {
  return (
    <MessageFrame
      align={presentation.frame.alignment}
      backgroundColor={getFrameBackgroundColor(presentation.frame.surface, theme)}
      borderColor={getFrameBorderColor(presentation, theme)}
      horizontalPadding={layout.horizontalPadding}
      maxWidth={layout.columnWidth}
      paddingX={1}
      paddingY={layout.sectionPaddingY}
      width={getFrameWidth(presentation, layout)}
    >
      <MessageHeader
        compact={layout.compact}
        marginBottom={layout.metaGapBottom}
        model={presentation.header}
        theme={theme}
      />
      <text>
        <span fg={theme.mutedText}>{message.text}</span>
      </text>
    </MessageFrame>
  )
}

function TaskMessage({
  message,
  presentation,
  theme,
  layout,
  activeToolCalls,
}: {
  message: TaskDisplayMessage
  presentation: MessagePresentation
  theme: ThemePalette
  layout: MessageLayout
  activeToolCalls: readonly ToolCallDisplayMessage["toolCall"][]
}) {
  const detailLine = getTaskDetailLine(message.task)
  const usageLine = formatTaskUsage(message.task.usage)
  const visibleActiveToolCalls = message.task.status === "running" ? activeToolCalls : []

  return (
    <MessageFrame
      align={presentation.frame.alignment}
      backgroundColor={getFrameBackgroundColor(presentation.frame.surface, theme)}
      borderColor={getFrameBorderColor(presentation, theme)}
      horizontalPadding={layout.horizontalPadding}
      maxWidth={layout.columnWidth}
      paddingX={1}
      paddingY={layout.sectionPaddingY}
      width={getFrameWidth(presentation, layout)}
    >
      <MessageHeader
        compact={layout.compact}
        marginBottom={layout.metaGapBottom}
        model={presentation.header}
        theme={theme}
      />
      <text>
        <span fg={theme.text}>{message.task.description}</span>
      </text>
      {detailLine ? (
        <box marginTop={1}>
          <text>
            <span fg={theme.mutedText}>{detailLine}</span>
          </text>
        </box>
      ) : null}
      {visibleActiveToolCalls.length > 0 ? (
        <box marginTop={1} flexDirection="column">
          <text>
            <span fg={theme.mutedText}>live tools</span>
          </text>
          {visibleActiveToolCalls.map((toolCall) => (
            <CompactToolRow key={toolCall.id} toolCall={toolCall} theme={theme} />
          ))}
        </box>
      ) : null}
      {usageLine ? (
        <box marginTop={1}>
          <text>
            <span fg={theme.mutedText}>{usageLine}</span>
          </text>
        </box>
      ) : null}
    </MessageFrame>
  )
}

function ErrorMessage({
  message,
  presentation,
  theme,
  layout,
}: {
  message: ErrorDisplayMessage
  presentation: MessagePresentation
  theme: ThemePalette
  layout: MessageLayout
}) {
  return (
    <MessageFrame
      align={presentation.frame.alignment}
      backgroundColor={getFrameBackgroundColor(presentation.frame.surface, theme)}
      borderColor={getFrameBorderColor(presentation, theme)}
      horizontalPadding={layout.horizontalPadding}
      maxWidth={layout.columnWidth}
      paddingX={layout.compact ? 1 : 2}
      paddingY={layout.sectionPaddingY}
      width={getFrameWidth(presentation, layout)}
    >
      <MessageHeader
        compact={layout.compact}
        marginBottom={layout.metaGapBottom}
        model={presentation.header}
        theme={theme}
      />
      <text>
        <span fg={theme.error}>{message.text}</span>
      </text>
    </MessageFrame>
  )
}

function getFrameWidth(presentation: MessagePresentation, layout: MessageLayout): number | "100%" {
  return presentation.frame.width === "user" ? layout.userBubbleWidth : "100%"
}

function getFrameBackgroundColor(
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
    case "userSurface":
      return theme.userSurface
    case "toolSurface":
      return theme.toolSurface
  }
}

function getFrameBorderColor(presentation: MessagePresentation, theme: ThemePalette): string {
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

function getStatusToneColor(
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
