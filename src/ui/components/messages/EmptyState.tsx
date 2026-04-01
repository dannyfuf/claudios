import type { StartupState } from "#state/types"
import type { MessageLayout } from "#ui/components/MessageArea.logic"
import { LoadingIndicator } from "#ui/components/LoadingIndicator"
import { getStartupAuthPresentation } from "#ui/startup-auth-presentation"
import type { ThemePalette } from "#ui/theme"

type EmptyStateProps = {
  readonly layout: MessageLayout
  readonly startup: StartupState
  readonly theme: ThemePalette
}

export function EmptyState({ layout, startup, theme }: EmptyStateProps) {
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
  theme: ThemePalette,
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
    const presentation = getStartupAuthPresentation(startup.auth)

    return {
      badge: presentation.badge,
      badgeTextColor: theme.error,
      context: "startup blocked",
      title: presentation.title,
      description: startup.auth.message,
      rows: presentation.rows,
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
