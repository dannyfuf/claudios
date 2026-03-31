/**
 * PromptInput — the single-line input at the bottom of the layout.
 *
 * Handles text entry for the shared composer state.
 */

import type { RefObject } from "react"
import type { InputRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { StartupState } from "#state/types"
import { LoadingIndicator } from "#ui/components/LoadingIndicator"
import { useConversationService, useConversationSelector, useThemePalette } from "#ui/hooks"

type PromptInputProps = {
  readonly canSubmit: boolean
  readonly onSubmit: () => void
  readonly hasModalFocus?: boolean
  readonly inputRef: RefObject<InputRenderable | null>
}

export function PromptInput(props: PromptInputProps) {
  const theme = useThemePalette()
  const { width } = useTerminalDimensions()
  const service = useConversationService()
  const sessionState = useConversationSelector((s) => s.sessionState)
  const startup = useConversationSelector((s) => s.startup)
  const vimMode = useConversationSelector((s) => s.vimMode)
  const promptText = useConversationSelector((s) => s.promptText)

  const isEditingDisabled =
    sessionState.status === "running" ||
    sessionState.status === "awaiting_permission"

  // In normal mode, input is not focused (keyboard goes to keymap handler)
  const isFocused =
    vimMode === "insert" &&
    sessionState.status !== "awaiting_permission" &&
    props.hasModalFocus !== true

  const isCompact = width < 92
  const showsLoadingIndicator =
    sessionState.status === "running" || isStartupLoading(startup)
  const promptTextColor = isEditingDisabled || !props.canSubmit ? theme.mutedText : theme.primary
  const loadingIndicatorColor = sessionState.status === "running" ? theme.primary : theme.warning
  const borderColor = isFocused ? theme.borderStrong : theme.borderSubtle
  const placeholder = isEditingDisabled
    ? "Waiting for Claude..."
    : !props.canSubmit
      ? getStartupPlaceholder(startup, isCompact)
      : isCompact
        ? "Message Claude"
        : "Ask Claude or type /command"

  return (
    <box paddingX={1}>
      <box
        height={3}
        border
        borderStyle="rounded"
        borderColor={borderColor}
        backgroundColor={theme.surface}
        paddingX={1}
      >
        <box flexDirection="row" gap={1} alignItems="center">
          <box width={1} minWidth={1} alignItems="center" justifyContent="center">
            {showsLoadingIndicator ? (
              <LoadingIndicator color={loadingIndicatorColor} />
            ) : (
              <text>
                <span fg={promptTextColor}>
                  <strong>{">"}</strong>
                </span>
              </text>
            )}
          </box>
          <input
            value={promptText}
            onChange={(value) => {
              if (!isEditingDisabled) {
                service.setPromptText(value)
              }
            }}
            onSubmit={() => {
              if (!isEditingDisabled && props.canSubmit) {
                props.onSubmit()
              }
            }}
            ref={props.inputRef}
            placeholder={placeholder}
            focused={isFocused}
            flexGrow={1}
            backgroundColor={theme.surface}
            textColor={theme.text}
            cursorColor={theme.focus}
            placeholderColor={theme.mutedText}
          />
        </box>
      </box>
    </box>
  )
}

// Export the submit handler so the global key handler can trigger it
export type PromptInputHandle = {
  submit: () => void
}

function isStartupLoading(startup: StartupState): boolean {
  return startup.auth.status === "loading" || startup.resume.status === "loading"
}

function getStartupPlaceholder(
  startup: StartupState,
  isCompact: boolean,
): string {
  if (startup.auth.status === "failed") {
    return isCompact ? "Claude auth required" : "Claude auth required before sending messages"
  }

  if (startup.resume.status === "loading") {
    return isCompact ? "Session loading..." : "Resuming session... you can keep typing"
  }

  return isCompact ? "Starting up..." : "Starting up... you can keep typing"
}
