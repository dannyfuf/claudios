/**
 * PermissionDialogContent — content rendered inside a dialog.confirm()
 * for tool permission prompts.
 *
 * Accepts the dialog context (resolve, dismiss, dialogId) and scopes
 * keyboard handling via useDialogKeyboard so that y/Enter allow and
 * n/Esc deny permission, without leaking events to lower layers.
 */

import { useDialogKeyboard } from "@opentui-ui/dialog/react"
import type { DialogId } from "@opentui-ui/dialog/react"
import { useThemePalette } from "#ui/hooks"

type PermissionDialogContentProps = {
  readonly kind: "tool" | "plan_exit"
  readonly toolName: string
  readonly toolInput: Record<string, unknown>
  readonly title?: string
  readonly description?: string
  readonly resolve: (value: boolean) => void
  readonly dismiss: () => void
  readonly dialogId: DialogId
}

export function PermissionDialogContent(props: PermissionDialogContentProps) {
  const { kind, toolName, toolInput, title, description, resolve, dismiss, dialogId } = props
  const theme = useThemePalette()
  const inputSummary = formatPermissionInput(toolInput)

  useDialogKeyboard((key) => {
    if (key.name === "return" || key.sequence === "y") resolve(true)
    if (key.name === "escape" || key.sequence === "n") dismiss()
  }, dialogId)

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={1}>
        <text>
          <span fg={theme.warning}>
            <strong>permission</strong>
          </span>
        </text>
        <text>
          <span fg={theme.text}>
            <strong>{toolName}</strong>
          </span>
        </text>
      </box>
      <text>
        <span fg={theme.text}>
          {title ??
            (kind === "plan_exit"
              ? "Claude wants to exit plan mode."
              : "Claude wants approval before running this tool.")}
        </span>
      </text>
      <text>
        <span fg={theme.mutedText}>
          {description ??
            (kind === "plan_exit"
              ? "Approve to restore write access, or deny to stay in read-only planning mode."
              : "Review the tool input, then allow or deny.")}
        </span>
      </text>
      {inputSummary ? (
        <box
          border
          borderStyle="rounded"
          borderColor={theme.borderSubtle}
          backgroundColor={theme.surfaceAlt}
          paddingX={1}
          paddingY={1}
        >
          <text>
            <span fg={theme.mutedText}>{inputSummary}</span>
          </text>
        </box>
      ) : null}
      <box flexDirection="row" gap={2} marginTop={1}>
        <text>
          <span fg={theme.success}>
            <strong>y/Enter</strong> allow
          </span>
        </text>
        <text>
          <span fg={theme.error}>
            <strong>n/Esc</strong> deny
          </span>
        </text>
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPermissionInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .slice(0, 5)
    .map(([key, value]) => `  ${key}: ${truncateEnd(formatUnknownValue(value), 54)}`)
    .join("\n")
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return "[unserializable]"
  }
}

function truncateEnd(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`
}
