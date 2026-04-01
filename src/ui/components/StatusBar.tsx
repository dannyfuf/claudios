/**
 * StatusBar — bottom line of the 4-zone layout.
 *
 * Shows: interaction mode | session state | keybind hints
 */

import { useTerminalDimensions } from "@opentui/react"
import type { SpinnerOptions } from "opentui-spinner"
import { getInteractionMode, isPlanModeActive, type SessionState, type StartupState } from "#state/types"
import { LoadingIndicator } from "#ui/components/LoadingIndicator"
import { formatTodoSummaryLine, getTodoProgress } from "#ui/components/MessageArea.logic"
import { AppBadge } from "#ui/components/StyledBadge"
import { useConversationSelector, useThemePalette } from "#ui/hooks"

type StatusBarProps = {
  readonly onTodosClick?: () => void
}

export function StatusBar({ onTodosClick }: StatusBarProps) {
  const theme = useThemePalette()
  const { width } = useTerminalDimensions()
  const interactionMode = useConversationSelector(getInteractionMode)
  const sessionState = useConversationSelector((s) => s.sessionState)
  const startup = useConversationSelector((s) => s.startup)
  const todoTracker = useConversationSelector((s) => s.todoTracker)
  const isCompact = width < 96
  const modeLabel =
    interactionMode === "plain"
      ? "PLAIN"
      : interactionMode === "insert"
        ? isCompact
          ? "INS"
          : "VIM INSERT"
        : isCompact
          ? "NRM"
          : "VIM NORMAL"
  const modeTextColor = interactionMode === "normal" ? theme.primary : theme.success

  const isPlanMode = useConversationSelector(isPlanModeActive)
  const sessionBadge = getSessionBadge(sessionState, isCompact, theme)
  const startupBadge = getStartupBadge(startup, isCompact, theme)
  const permissionBadge = getPermissionBadge(isPlanMode, isCompact, theme)

  const todoItems = todoTracker?.items ?? []
  const allDone =
    todoItems.length > 0 && getTodoProgress(todoItems).completedCount === todoItems.length
  const todoSummary =
    todoItems.length > 0
      ? formatTodoSummaryLine(todoItems, isCompact ? 18 : 36)
      : null

  const helpKey = interactionMode === "plain" ? "Ctrl+/" : "?"
  const hints = isCompact
    ? `${helpKey} help  Esc×2 cancel`
    : `${helpKey} help  Esc Esc cancel`

  return (
    <box
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      paddingX={1}
      backgroundColor={theme.shell}
    >
      <box flexDirection="row" gap={1} minWidth={0}>
        <AppBadge
          label={modeLabel}
          textColor={modeTextColor}
          variant="ghost"
          strong
        />
        {startupBadge ? <StatusBadge badge={startupBadge} /> : null}
        {sessionBadge ? <StatusBadge badge={sessionBadge} /> : null}
        {permissionBadge ? <StatusBadge badge={permissionBadge} /> : null}
        {todoSummary ? (
          <box
            flexDirection="row"
            gap={1}
            paddingX={1}
            minWidth={0}
            {...(onTodosClick ? { onMouseDown: onTodosClick } : {})}
          >
            <text>
              <span fg={allDone ? theme.mutedText : theme.warning}>◦ </span>
              <span fg={allDone ? theme.mutedText : theme.warning}>{todoSummary}</span>
            </text>
            {!allDone ? (
              <text>
                <span fg={theme.mutedText}>Ctrl+T</span>
              </text>
            ) : null}
          </box>
        ) : null}
      </box>
      <box flexDirection="row" gap={1} minWidth={0}>
        <text>
          <span fg={theme.mutedText}>{hints}</span>
        </text>
      </box>
    </box>
  )
}

type StatusBadgeModel = {
  readonly label: string
  readonly textColor: string
  readonly loading: boolean
  readonly spinnerName?: SpinnerOptions["name"]
}

function StatusBadge({ badge }: { readonly badge: StatusBadgeModel }) {
  if (badge.loading) {
    return (
      <box flexDirection="row" gap={1} paddingX={1} minWidth={0} alignItems="center">
        <LoadingIndicator color={badge.textColor} name={badge.spinnerName} />
        <text>
          <span fg={badge.textColor}>{badge.label}</span>
        </text>
      </box>
    )
  }

  return <AppBadge label={badge.label} textColor={badge.textColor} variant="ghost" />
}

function getSessionBadge(
  sessionState: SessionState,
  isCompact: boolean,
  theme: ReturnType<typeof useThemePalette>,
): StatusBadgeModel | null {
  switch (sessionState.status) {
    case "idle":
      return null
    case "running":
      return {
        label: isCompact ? "working" : "Claude working",
        textColor: theme.primary,
        loading: true,
        spinnerName: "balloon",
      }
    case "awaiting_permission":
      return {
        label: isCompact ? "awaiting" : "awaiting permission",
        textColor: theme.warning,
        loading: false,
      }
    case "error":
      return {
        label: truncateEnd(sessionState.message, isCompact ? 24 : 40),
        textColor: theme.error,
        loading: false,
      }
  }
}

function getStartupBadge(
  startup: StartupState,
  isCompact: boolean,
  theme: ReturnType<typeof useThemePalette>,
): StatusBadgeModel | null {
  if (startup.auth.status === "loading") {
    return {
      label: isCompact ? "booting" : "checking auth",
      textColor: theme.warning,
      loading: true,
    }
  }

  if (startup.resume.status === "loading") {
    return {
      label: isCompact ? "resume" : "resuming session",
      textColor: theme.warning,
      loading: true,
    }
  }

  if (startup.metadata.status === "loading") {
    return {
      label: isCompact ? "models" : "loading models",
      textColor: theme.warning,
      loading: true,
    }
  }

  if (startup.auth.status === "failed") {
    return {
      label: isCompact ? "auth req" : "authentication required",
      textColor: theme.error,
      loading: false,
    }
  }

  if (startup.resume.status === "failed") {
    return {
      label: isCompact ? "resume err" : "resume failed",
      textColor: theme.error,
      loading: false,
    }
  }

  if (startup.metadata.status === "failed") {
    return {
      label: isCompact ? "model err" : "model metadata failed",
      textColor: theme.error,
      loading: false,
    }
  }

  return null
}

function getPermissionBadge(
  isPlanMode: boolean,
  isCompact: boolean,
  theme: ReturnType<typeof useThemePalette>,
): StatusBadgeModel | null {
  if (!isPlanMode) return null
  return {
    label: isCompact ? "plan" : "plan mode",
    textColor: theme.warning,
    loading: false,
  }
}

function truncateEnd(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`
}
