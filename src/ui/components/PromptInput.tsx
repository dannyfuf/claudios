/**
 * PromptInput — the single-line input at the bottom of the layout.
 *
 * Handles text entry for the shared composer state.
 */

import type { RefObject } from "react"
import type { InputRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { getInteractionMode, type StartupState } from "#state/types"
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
  const interactionMode = useConversationSelector(getInteractionMode)
  const promptText = useConversationSelector((s) => s.promptText)

  const isEditingDisabled =
    sessionState.status === "running" ||
    sessionState.status === "awaiting_permission"

  const isFocused =
    interactionMode !== "normal" &&
    sessionState.status !== "awaiting_permission" &&
    props.hasModalFocus !== true

  const handlePromptMouseDown = () => {
    if (!isEditingDisabled) {
      service.setVimMode("insert")
    }
  }

  const isCompact = width < 92
  const showsLoadingIndicator = isStartupLoading(startup)
  const promptTextColor = isEditingDisabled || !props.canSubmit ? theme.mutedText : theme.primary
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
        onMouseDown={handlePromptMouseDown}
      >
        <box flexDirection="row" gap={1} alignItems="center">
          <box width={1} minWidth={1} alignItems="center" justifyContent="center">
            {showsLoadingIndicator ? (
              <LoadingIndicator color={theme.warning} />
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
            onMouseDown={handlePromptMouseDown}
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
