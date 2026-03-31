/**
 * StatusBar — bottom line of the 4-zone layout.
 *
 * Shows: vim mode | session state | keybind hints
 */

import { useTerminalDimensions } from "@opentui/react"
import type { SessionState, StartupState } from "#state/types"
import { LoadingIndicator } from "#ui/components/LoadingIndicator"
import { AppBadge } from "#ui/components/StyledBadge"
import { useConversationSelector, useThemePalette } from "#ui/hooks"

export function StatusBar() {
  const theme = useThemePalette()
  const { width } = useTerminalDimensions()
  const vimMode = useConversationSelector((s) => s.vimMode)
  const sessionState = useConversationSelector((s) => s.sessionState)
  const startup = useConversationSelector((s) => s.startup)
  const permissionMode = useConversationSelector((s) => s.permissionMode)
  const diffMode = useConversationSelector((s) => s.diffMode)

  const isCompact = width < 96
  const modeLabel =
    vimMode === "insert"
      ? isCompact
        ? "INS"
        : "INSERT"
      : isCompact
        ? "NRM"
        : "NORMAL"
  const modeTextColor = vimMode === "insert" ? theme.success : theme.primary

  const sessionBadge = getSessionBadge(sessionState, isCompact, theme)
  const startupBadge = getStartupBadge(startup, isCompact, theme)

  const permissionLabel = isCompact ? permissionMode : `perm ${permissionMode}`
  const diffLabel = isCompact
    ? diffMode === "split"
      ? "split"
      : "unified"
    : `${diffMode} diff`
  const hints =
    width < 84
      ? "^P model  ^R sessions  ^C quit"
      : width < 120
        ? "Ctrl+P model  Ctrl+R sessions  Ctrl+C quit"
        : width < 150
          ? "Ctrl+N new  Ctrl+P model  Ctrl+R sessions  Ctrl+C quit"
          : "Ctrl+N new  Ctrl+P model  Ctrl+R sessions  Ctrl+E editor  Ctrl+C quit"

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
      </box>
      <box flexDirection="row" gap={1} minWidth={0}>
        {width >= 92 ? (
          <text>
            <span fg={theme.mutedText}>{permissionLabel}</span>
          </text>
        ) : null}
        <text>
          <span fg={theme.mutedText}>{diffLabel}</span>
        </text>
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
}

function StatusBadge({ badge }: { readonly badge: StatusBadgeModel }) {
  if (badge.loading) {
    return (
      <box flexDirection="row" gap={1} paddingX={1} minWidth={0} alignItems="center">
        <LoadingIndicator color={badge.textColor} />
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
        label: isCompact ? "running" : "running now",
        textColor: theme.primary,
        loading: true,
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

function truncateEnd(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`
}
