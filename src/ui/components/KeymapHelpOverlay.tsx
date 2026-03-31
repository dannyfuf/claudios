/**
 * KeymapHelpContent — content rendered inside a dialog.alert()
 * for displaying keybinding help.
 *
 * Accepts bindings, dismiss, and dialogId from the dialog context.
 * Uses useDialogKeyboard to handle ? and Esc for closing.
 */

import { useMemo } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { useDialogKeyboard } from "@opentui-ui/dialog/react"
import type { DialogId } from "@opentui-ui/dialog/react"
import type { KeymapEntry } from "#commands/keymap"
import { useThemePalette } from "#ui/hooks"

type KeymapHelpContentProps = {
  readonly bindings: readonly KeymapEntry[]
  readonly dismiss: () => void
  readonly dialogId: DialogId
}

export function KeymapHelpContent(props: KeymapHelpContentProps) {
  const { bindings, dismiss, dialogId } = props
  const theme = useThemePalette()
  const { width, height } = useTerminalDimensions()
  // Dialog container is "large" = 80 cols. Account for dialog border (2)
  // and content paddingX (2) to estimate usable text width for truncation.
  const effectiveWidth = Math.min(width, 80) - 4
  const descriptionWidth = Math.max(16, effectiveWidth - 28)
  // Dialog auto-sizes height to content — set explicit height so the
  // scrollbox has room to grow. Subtract 8 for dialog chrome (border +
  // padding) and centering margin.
  const panelHeight = Math.max(12, Math.min(height - 8, 24))

  const rows = useMemo(
    () =>
      bindings.map((binding) => ({
        id: `${binding.context}:${binding.mode ?? "all"}:${binding.key}:${binding.action}`,
        keyLabel: binding.key,
        scopeLabel: binding.mode ? `${binding.context}/${binding.mode}` : binding.context,
        description: truncateEnd(binding.description, descriptionWidth),
      })),
    [bindings, descriptionWidth],
  )

  useDialogKeyboard((key) => {
    if (key.name === "escape" || key.sequence === "?") {
      dismiss()
    }
  }, dialogId)

  return (
    <box flexDirection="column" width="100%" height={panelHeight}>
      <box padding={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text>
            <span fg={theme.text}>
              <strong>keymaps</strong>
            </span>
          </text>
          <text>
            <span fg={theme.mutedText}>{bindings.length} bindings</span>
          </text>
        </box>
        <text>
          <span fg={theme.mutedText}>? / Esc close</span>
        </text>
      </box>

      <box paddingX={1} paddingBottom={1}>
        <text>
          <span fg={theme.mutedText}>Available shortcuts by context and vim mode.</span>
        </text>
      </box>

      <scrollbox flexGrow={1} paddingX={1} paddingBottom={1}>
        {rows.map((row) => (
          <box key={row.id} flexDirection="row" gap={1} marginBottom={1}>
            <box minWidth={12} maxWidth={12}>
              <text>
                <span fg={theme.text}>
                  <strong>{row.keyLabel}</strong>
                </span>
              </text>
            </box>
            <box flexGrow={1} minWidth={0}>
              <text>
                <span fg={theme.text}>{row.description}</span>
              </text>
            </box>
            <box minWidth={14} maxWidth={14}>
              <text>
                <span fg={theme.mutedText}>{row.scopeLabel}</span>
              </text>
            </box>
          </box>
        ))}
      </scrollbox>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateEnd(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`
}
