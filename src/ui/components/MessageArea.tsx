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
  formatTaskKindLabel,
  getToolCallDiffFileChange,
  getTaskContextLabel,
  formatTaskUsage,
  getMessageLayout,
  getTaskDetailLine,
  getTaskStatusPresentation,
  getToolBriefDetail,
  getToolStatusPresentation,
  mergeConsecutiveThinkingMessages,
  normalizeToolLabel,
  shouldShowAssistantResponseDivider,
  type StatusTone,
  type MessageLayout,
} from "#ui/components/MessageArea.logic"
import { LoadingIndicator } from "#ui/components/LoadingIndicator"

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
          const showAssistantResponseDivider =
            msg.kind === "assistant" && shouldShowAssistantResponseDivider(visibleMessages, i)

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
              showAssistantResponseDivider={showAssistantResponseDivider}
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
  if (message.kind !== "thinking" && message.kind !== "tool_call") {
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
  showAssistantResponseDivider,
  diffMode,
}: {
  message: DisplayMessage
  syntaxStyle: SyntaxStyle
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
  taskContextLabel: string | null
  activeTaskToolCalls: ReadonlyMap<string, readonly ToolCallDisplayMessage["toolCall"][]>
  showAssistantResponseDivider: boolean
  diffMode: "unified" | "split"
}) {
  switch (message.kind) {
    case "user":
      return <UserMessage message={message} theme={theme} layout={layout} />
    case "assistant":
      return (
        <AssistantMessage
          message={message}
          syntaxStyle={syntaxStyle}
          theme={theme}
          layout={layout}
          showAssistantResponseDivider={showAssistantResponseDivider}
        />
      )
    case "thinking":
      return (
        <ThinkingMessage
          message={message}
          theme={theme}
          layout={layout}
          taskContextLabel={taskContextLabel}
        />
      )
    case "tool_call":
      return (
        <ToolCallMessage
          message={message}
          syntaxStyle={syntaxStyle}
          theme={theme}
          layout={layout}
          taskContextLabel={taskContextLabel}
          diffMode={diffMode}
        />
      )
    case "system":
      return <SystemMessage message={message} theme={theme} layout={layout} />
    case "task":
      return (
        <TaskMessage
          message={message}
          theme={theme}
          layout={layout}
          activeToolCalls={activeTaskToolCalls.get(message.task.id) ?? []}
        />
      )
    case "error":
      return <ErrorMessage message={message} theme={theme} layout={layout} />
  }
}

function UserMessage({
  message,
  theme,
  layout,
}: {
  message: UserDisplayMessage
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
}) {
  return (
    <box
      paddingX={layout.horizontalPadding}
      marginBottom={1}
      alignItems="center"
    >
      <box width="100%" maxWidth={layout.columnWidth} flexDirection="column" alignItems="flex-end">
        <box
          width={layout.userBubbleWidth}
          border
          borderStyle="rounded"
          borderColor={theme.borderStrong}
          backgroundColor={theme.userSurface}
          paddingX={layout.compact ? 1 : 2}
          paddingY={layout.sectionPaddingY}
        >
          <text>
            <span fg={theme.text}>{message.text}</span>
          </text>
        </box>
        <box flexDirection="row" gap={1} marginTop={layout.compact ? 0 : 1}>
          <text>
            <span fg={theme.mutedText}>you</span>
          </text>
          <text>
            <span fg={theme.mutedText}>{formatTime(message.timestamp)}</span>
          </text>
        </box>
      </box>
    </box>
  )
}

function AssistantMessage({
  message,
  syntaxStyle,
  theme,
  layout,
  showAssistantResponseDivider,
}: {
  message: AssistantDisplayMessage
  syntaxStyle: SyntaxStyle
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
  showAssistantResponseDivider: boolean
}) {
  const hasText = message.text.trim().length > 0

  return (
    <box
      paddingX={layout.horizontalPadding}
      marginBottom={1}
      alignItems="center"
    >
      <box
        width="100%"
        maxWidth={layout.columnWidth}
        flexDirection="column"
      >
        {showAssistantResponseDivider ? (
          <AssistantResponseDivider theme={theme} compact={layout.compact} />
        ) : null}
        {hasText ? (
          <box paddingX={layout.compact ? 0 : 1}>
            <markdown
              content={message.text}
              streaming={message.isStreaming}
              syntaxStyle={syntaxStyle}
            />
          </box>
        ) : null}
        {hasText || message.isStreaming ? (
          <box
            flexDirection="row"
            gap={1}
            marginTop={hasText ? 1 : 0}
            paddingX={layout.compact ? 0 : 1}
          >
            <text>
              <span fg={theme.mutedText}>claude</span>
            </text>
            <text>
              <span fg={theme.mutedText}>{formatTime(message.timestamp)}</span>
            </text>
            {message.isStreaming ? (
              <text>
                <span fg={theme.primary}>
                  <strong>{layout.compact ? "live" : "streaming"}</strong>
                </span>
              </text>
            ) : null}
          </box>
        ) : null}
      </box>
    </box>
  )
}

function ThinkingMessage({
  message,
  theme,
  layout,
  taskContextLabel,
}: {
  message: ThinkingDisplayMessage
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
  taskContextLabel: string | null
}) {
  const thinkingLines = message.text.split("\n")

  return (
    <box
      paddingX={layout.horizontalPadding}
      marginBottom={1}
      alignItems="center"
    >
      <box
        width="100%"
        maxWidth={layout.columnWidth}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={theme.borderSubtle}
        paddingX={1}
        paddingY={0}
      >
        <box flexDirection="row" justifyContent="space-between" gap={1} marginBottom={layout.metaGapBottom}>
          <box flexDirection="row" gap={1} minWidth={0}>
            <text>
              <span fg={theme.mutedText}>thinking</span>
            </text>
            {taskContextLabel ? (
              <text>
                <span fg={theme.mutedText}>{taskContextLabel}</span>
              </text>
            ) : null}
          </box>
          <box flexDirection="row" gap={1}>
            <text>
              <span fg={theme.mutedText}>{formatTime(message.timestamp)}</span>
            </text>
            {message.isStreaming ? (
              <text>
                <span fg={theme.mutedText}>{layout.compact ? "live" : "streaming"}</span>
              </text>
            ) : null}
          </box>
        </box>
        <box paddingLeft={layout.compact ? 1 : 2} flexDirection="column">
          {thinkingLines.map((line, index) => (
            <text key={`${message.uuid}:${index}`}>
              <span fg={theme.mutedText}>
                <em>{line}</em>
              </span>
            </text>
          ))}
        </box>
      </box>
    </box>
  )
}

function AssistantResponseDivider({
  theme,
  compact,
}: {
  theme: ReturnType<typeof useThemePalette>
  compact: boolean
}) {
  return (
    <box justifyContent="center" marginBottom={1}>
      <text>
        <span fg={theme.mutedText}>{compact ? "response" : "-- response --"}</span>
      </text>
    </box>
  )
}

function ToolCallMessage({
  message,
  syntaxStyle,
  theme,
  layout,
  taskContextLabel,
  diffMode,
}: {
  message: ToolCallDisplayMessage
  syntaxStyle: SyntaxStyle
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
  taskContextLabel: string | null
  diffMode: "unified" | "split"
}) {
  const fileChange = getToolCallDiffFileChange(message.toolCall)

  return (
    <box
      paddingX={layout.horizontalPadding}
      marginBottom={1}
      alignItems="center"
    >
      <box
        width="100%"
        maxWidth={layout.columnWidth}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={theme.borderSubtle}
        backgroundColor={theme.toolSurface}
        paddingX={1}
        paddingY={layout.sectionPaddingY}
      >
        <box flexDirection="row" justifyContent="space-between" gap={1} marginBottom={layout.metaGapBottom}>
          <box flexDirection="row" gap={1} minWidth={0}>
            <text>
              <span fg={theme.mutedText}>tool</span>
            </text>
            {taskContextLabel ? (
              <text>
                <span fg={theme.mutedText}>{taskContextLabel}</span>
              </text>
            ) : null}
          </box>
          <text>
            <span fg={theme.mutedText}>{formatTime(message.timestamp)}</span>
          </text>
        </box>
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
      </box>
    </box>
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
  theme: ReturnType<typeof useThemePalette>
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
  theme,
  layout,
}: {
  message: SystemDisplayMessage
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
}) {
  return (
    <box
      paddingX={layout.horizontalPadding}
      marginBottom={1}
      alignItems="center"
    >
      <box
        width="100%"
        maxWidth={layout.columnWidth}
        paddingX={layout.compact ? 0 : 1}
      >
        <box flexDirection="row" gap={1} marginBottom={layout.metaGapBottom}>
          <text>
            <span fg={theme.mutedText}>system</span>
          </text>
          <text>
            <span fg={theme.mutedText}>{formatTime(message.timestamp)}</span>
          </text>
        </box>
        <text>
          <span fg={theme.mutedText}>{message.text}</span>
        </text>
      </box>
    </box>
  )
}

function TaskMessage({
  message,
  theme,
  layout,
  activeToolCalls,
}: {
  message: TaskDisplayMessage
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
  activeToolCalls: readonly ToolCallDisplayMessage["toolCall"][]
}) {
  const statusPresentation = getTaskStatusPresentation(message.task.status)
  const statusColor = getStatusToneColor(statusPresentation.tone, theme)
  const kindLabel = formatTaskKindLabel(message.task)
  const detailLine = getTaskDetailLine(message.task)
  const usageLine = formatTaskUsage(message.task.usage)
  const visibleActiveToolCalls = message.task.status === "running" ? activeToolCalls : []

  return (
    <box
      paddingX={layout.horizontalPadding}
      marginBottom={1}
      alignItems="center"
    >
      <box
        width="100%"
        maxWidth={layout.columnWidth}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={statusColor}
        backgroundColor={theme.toolSurface}
        paddingX={1}
        paddingY={layout.sectionPaddingY}
      >
        <box flexDirection="row" justifyContent="space-between" gap={1} marginBottom={layout.metaGapBottom}>
          <box flexDirection="row" gap={1} minWidth={0}>
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
              <span fg={statusColor}>
                <strong>{message.task.status}</strong>
              </span>
            </text>
            <text>
              <span fg={theme.mutedText}>{kindLabel}</span>
            </text>
          </box>
          <text>
            <span fg={theme.mutedText}>{formatTime(message.timestamp)}</span>
          </text>
        </box>
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
          <box marginTop={detailLine || visibleActiveToolCalls.length > 0 ? 1 : 1}>
            <text>
              <span fg={theme.mutedText}>{usageLine}</span>
            </text>
          </box>
        ) : null}
      </box>
    </box>
  )
}

function ErrorMessage({
  message,
  theme,
  layout,
}: {
  message: ErrorDisplayMessage
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
}) {
  return (
    <box
      paddingX={layout.horizontalPadding}
      marginBottom={1}
      alignItems="center"
    >
      <box
        width="100%"
        maxWidth={layout.columnWidth}
        border
        borderStyle="rounded"
        borderColor={theme.error}
        backgroundColor={theme.surfaceAlt}
        paddingX={layout.compact ? 1 : 2}
        paddingY={layout.sectionPaddingY}
      >
        <box flexDirection="row" gap={1} marginBottom={layout.metaGapBottom}>
          <text>
            <span fg={theme.error}>
              <strong>{message.recoverable ? "error" : "fatal"}</strong>
            </span>
          </text>
          <text>
            <span fg={theme.mutedText}>{formatTime(message.timestamp)}</span>
          </text>
        </box>
        <text>
          <span fg={theme.error}>{message.text}</span>
        </text>
      </box>
    </box>
  )
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function getStatusToneColor(
  tone: StatusTone,
  theme: ReturnType<typeof useThemePalette>,
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
