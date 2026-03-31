/**
 * MessageArea — the scrollable message display in the center zone.
 *
 * Renders user messages, assistant markdown (with streaming), tool calls,
 * system messages, spawned task activity, and error blocks.
 */

import {
  useMemo,
  useState,
  type RefObject,
} from "react"
import { ScrollBoxRenderable, SyntaxStyle } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { ToolCall } from "#sdk/types"
import { useConversationState, useThemePalette } from "#ui/hooks"
import type {
  DisplayMessage,
  UserDisplayMessage,
  AssistantDisplayMessage,
  SystemDisplayMessage,
  TaskDisplayMessage,
  ErrorDisplayMessage,
  StartupState,
} from "#state/types"
import {
  formatTaskKindLabel,
  formatTaskUsage,
  getMessageLayout,
  getTaskDetailLine,
  getTaskStatusPresentation,
  getToolBriefDetail,
  getToolStatusPresentation,
  getVisibleToolCalls,
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
  const { messages, startup, streamingText } = state
  const layout = useMemo(() => getMessageLayout(width), [width])

  // Create a shared SyntaxStyle for all markdown blocks.
  const syntaxStyle = useMemo(() => SyntaxStyle.create(), [])

  return (
    <scrollbox ref={props.scrollRef} height="100%" stickyScroll stickyStart="bottom">
      {messages.length === 0 && !streamingText ? (
        <EmptyState layout={layout} startup={startup} theme={theme} />
      ) : (
        messages.map((msg, i) => {
          const currentStreamingText =
            msg.kind === "assistant" && msg.isStreaming ? streamingText : null
          const showAssistantResponseDivider =
            msg.kind === "assistant" && shouldShowAssistantResponseDivider(messages, i)

          return (
            <MessageBlock
              key={msg.uuid ?? String(i)}
              message={msg}
              streamingText={currentStreamingText}
              syntaxStyle={syntaxStyle}
              theme={theme}
              layout={layout}
              showAssistantResponseDivider={showAssistantResponseDivider}
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
      rows: ["Run `claude auth login`, then restart better-claude."],
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

function MessageBlock({
  message,
  streamingText,
  syntaxStyle,
  theme,
  layout,
  showAssistantResponseDivider,
}: {
  message: DisplayMessage
  streamingText: string | null
  syntaxStyle: SyntaxStyle
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
  showAssistantResponseDivider: boolean
}) {
  switch (message.kind) {
    case "user":
      return <UserMessage message={message} theme={theme} layout={layout} />
    case "assistant":
      return (
        <AssistantMessage
          message={message}
          streamingText={streamingText}
          syntaxStyle={syntaxStyle}
          theme={theme}
          layout={layout}
          showAssistantResponseDivider={showAssistantResponseDivider}
        />
      )
    case "system":
      return <SystemMessage message={message} theme={theme} layout={layout} />
    case "task":
      return <TaskMessage message={message} theme={theme} layout={layout} />
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
      marginBottom={layout.compact ? 1 : 2}
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
  streamingText,
  syntaxStyle,
  theme,
  layout,
  showAssistantResponseDivider,
}: {
  message: AssistantDisplayMessage
  streamingText: string | null
  syntaxStyle: SyntaxStyle
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
  showAssistantResponseDivider: boolean
}) {
  const content = streamingText ?? message.text
  const hasText = content.trim().length > 0
  const hasTools = message.toolCalls.length > 0

  return (
    <box
      paddingX={layout.horizontalPadding}
      marginBottom={layout.compact ? 1 : 2}
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
        {hasTools ? (
          <box>
            <ToolActivityBlock
              toolCalls={message.toolCalls}
              theme={theme}
              compact={layout.compact}
            />
          </box>
        ) : null}
        {hasText ? (
          <box marginTop={hasTools ? 1 : 0} paddingX={layout.compact ? 0 : 1}>
            <markdown
              content={content}
              streaming={message.isStreaming}
              syntaxStyle={syntaxStyle}
            />
          </box>
        ) : null}
        {hasText || message.isStreaming ? (
          <box
            flexDirection="row"
            gap={1}
            marginTop={hasText || hasTools ? 1 : 0}
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

/**
 * Visible block showing compact one-line rows for each tool call.
 * Overflow is collapsible so long work logs stay readable.
 */
function ToolActivityBlock({
  toolCalls,
  theme,
  compact,
}: {
  toolCalls: readonly ToolCall[]
  theme: ReturnType<typeof useThemePalette>
  compact: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const maxVisible = compact ? 3 : 4
  const { visibleToolCalls, hiddenCount, hasOverflow } = getVisibleToolCalls(
    toolCalls,
    expanded,
    maxVisible,
  )
  const runningCount = toolCalls.filter((tc) => tc.status === "running").length
  const completedCount = toolCalls.filter((tc) => tc.status === "completed").length
  const errorCount = toolCalls.length - runningCount - completedCount

  const summaryParts: string[] = []
  if (runningCount > 0) summaryParts.push(`${runningCount} running`)
  if (completedCount > 0) summaryParts.push(`${completedCount} done`)
  if (errorCount > 0) summaryParts.push(`${errorCount} failed`)

  const showHeader = toolCalls.length > 1
  const headerSummary = `${toolCalls.length} step${toolCalls.length !== 1 ? "s" : ""}${
    !compact && summaryParts.length > 0 ? `, ${summaryParts.join(", ")}` : ""
  }`

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.borderSubtle}
      backgroundColor={theme.toolSurface}
      paddingX={1}
      paddingY={compact ? 0 : 1}
    >
      {showHeader ? (
        <box flexDirection="row" justifyContent="space-between" gap={1} marginBottom={compact ? 0 : 1}>
          <text>
            <span fg={theme.mutedText}>work log</span>
          </text>
          <text>
            <span fg={theme.mutedText}>{headerSummary}</span>
          </text>
        </box>
      ) : null}
      <box flexDirection="column">
        {visibleToolCalls.map((toolCall) => (
          <CompactToolRow
            key={toolCall.id}
            toolCall={toolCall}
            theme={theme}
          />
        ))}
      </box>
      {hasOverflow ? (
        <box marginTop={compact ? 0 : 1} flexDirection="row" justifyContent="space-between" gap={1}>
          <text>
            <span fg={theme.mutedText}>
              {expanded
                ? `showing all ${toolCalls.length} steps`
                : `${hiddenCount} earlier step${hiddenCount !== 1 ? "s" : ""} hidden`}
            </span>
          </text>
          <box onMouseDown={() => setExpanded((current) => !current)}>
            <text>
              <span fg={theme.primary}>{expanded ? "show less" : "show more"}</span>
            </text>
          </box>
        </box>
      ) : null}
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
  toolCall: ToolCall
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
      marginBottom={layout.compact ? 1 : 2}
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
}: {
  message: TaskDisplayMessage
  theme: ReturnType<typeof useThemePalette>
  layout: MessageLayout
}) {
  const statusPresentation = getTaskStatusPresentation(message.task.status)
  const statusColor = getStatusToneColor(statusPresentation.tone, theme)
  const kindLabel = formatTaskKindLabel(message.task)
  const detailLine = getTaskDetailLine(message.task)
  const usageLine = formatTaskUsage(message.task.usage)

  return (
    <box
      paddingX={layout.horizontalPadding}
      marginBottom={layout.compact ? 1 : 2}
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
        {usageLine ? (
          <box marginTop={detailLine ? 0 : 1}>
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
      marginBottom={layout.compact ? 1 : 2}
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
