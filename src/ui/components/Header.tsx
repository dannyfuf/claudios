/**
 * Header component — top line of the 4-zone layout.
 *
 * Shows: model name | session id | token/cost info | account
 */

import { useTerminalDimensions } from "@opentui/react"
import { AppBadge } from "#ui/components/StyledBadge"
import { useConversationSelector, useThemePalette } from "#ui/hooks"

export function Header() {
  const theme = useThemePalette()
  const { width } = useTerminalDimensions()
  const model = useConversationSelector((s) => s.model)
  const sessionId = useConversationSelector((s) => s.sessionId)
  const totalCostUsd = useConversationSelector((s) => s.totalCostUsd)
  const totalTokens = useConversationSelector((s) => s.totalTokens)
  const account = useConversationSelector((s) => s.account)

  const isCompact = width < 96
  const isTight = width < 84
  const appLabel = width < 90 ? "bc" : "better-claude"
  const sessionLabel = sessionId ? sessionId.slice(0, isTight ? 6 : 8) : "new"
  const modelLabel = truncateEnd(model, isCompact ? 12 : 18)
  const costLabel = totalCostUsd > 0 ? `$${totalCostUsd.toFixed(4)}` : ""
  const tokenLabel = totalTokens > 0 ? `${formatTokens(totalTokens)} tok` : ""
  const accountLabel = account?.email
    ? truncateMiddle(account.email, isCompact ? 18 : 28)
    : ""

  return (
    <box
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      paddingX={1}
      backgroundColor={theme.chrome}
    >
      <box flexDirection="row" gap={1} minWidth={0}>
        <AppBadge
          label={appLabel}
          textColor={theme.primary}
          variant="ghost"
          strong
        />
        <text>
          <span fg={theme.text}>{modelLabel}</span>
        </text>
        <text>
          <span fg={theme.mutedText}>{isTight ? sessionLabel : `sess:${sessionLabel}`}</span>
        </text>
      </box>
      <box flexDirection="row" gap={1} minWidth={0}>
        {tokenLabel ? (
          <text>
            <span fg={theme.mutedText}>{tokenLabel}</span>
          </text>
        ) : null}
        {costLabel && width >= 92 ? (
          <text>
            <span fg={theme.mutedText}>{costLabel}</span>
          </text>
        ) : null}
        {accountLabel && width >= 118 ? (
          <text>
            <span fg={theme.mutedText}>{accountLabel}</span>
          </text>
        ) : null}
      </box>
    </box>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function truncateEnd(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const visible = Math.max(4, maxLength - 1)
  const start = Math.ceil(visible / 2)
  const end = Math.floor(visible / 2)
  return `${value.slice(0, start)}…${value.slice(value.length - end)}`
}
