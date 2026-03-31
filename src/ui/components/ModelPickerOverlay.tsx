/**
 * ModelPickerDialogContent — self-contained content rendered inside
 * a dialog.prompt<string>() for selecting a model.
 *
 * Manages its own filter text, selected index, loading, and error
 * state internally. Keyboard handling is scoped via useDialogKeyboard.
 *
 * The dialog container controls width via its `size` prop.
 * Content fills width with width="100%" and sets an explicit height
 * based on terminal dimensions (the dialog auto-sizes to content height).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTerminalDimensions } from "@opentui/react"
import type { InputRenderable } from "@opentui/core"
import { useDialogKeyboard } from "@opentui-ui/dialog/react"
import type { DialogId } from "@opentui-ui/dialog/react"
import type { ModelInfo } from "#sdk/types"
import { getInteractionMode } from "#state/types"
import { LoadingIndicator } from "#ui/components/LoadingIndicator"
import { useConversationSelector, useConversationService, useThemePalette } from "#ui/hooks"
import { filterByPrefixQuery } from "#ui/picker-filter"
import { resolvePickerKeyboardAction } from "#ui/picker-keyboard"

type ModelPickerDialogContentProps = {
  readonly initialModel: string
  readonly resolve: (value: string) => void
  readonly dismiss: () => void
  readonly dialogId: DialogId
}

export function ModelPickerDialogContent(props: ModelPickerDialogContentProps) {
  const { initialModel, resolve, dismiss, dialogId } = props
  const theme = useThemePalette()
  const service = useConversationService()
  const { width, height } = useTerminalDimensions()
  const vimEnabled = useConversationSelector((s) => s.vimEnabled)
  const vimMode = useConversationSelector((s) => s.vimMode)
  const interactionMode = useConversationSelector(getInteractionMode)
  const availableModels = useConversationSelector((s) => s.availableModels)
  const metadata = useConversationSelector((s) => s.startup.metadata)

  const [filterText, setFilterText] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<InputRenderable | null>(null)

  const isCompact = width < 96
  // Dialog auto-sizes height to content — set explicit height so the
  // select list has room to grow. Subtract 8 for dialog chrome (border +
  // padding) and centering margin.
  const panelHeight = Math.max(12, Math.min(height - 8, 24))

  const filteredModels = useMemo(() => {
    return filterByPrefixQuery(availableModels, filterText, (model) => [
      model.displayName,
      model.value,
      model.description,
    ])
  }, [availableModels, filterText])

  const options = useMemo(
    () =>
      filteredModels.map((model) => ({
        name: truncateEnd(model.displayName, isCompact ? 24 : 36),
        description: formatModelDescription(model, isCompact ? 40 : 60),
        value: model.value,
      })),
    [filteredModels, isCompact],
  )

  const isListFocused = vimEnabled ? interactionMode === "normal" : vimMode === "normal"
  const isInputFocused = !isListFocused

  const emptyMessage = filterText.trim()
    ? "No matching models"
    : "No models reported by the SDK yet"

  // Reset selected index when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [filterText])

  const handleSelect = useCallback((index = selectedIndex) => {
    const model = filteredModels[index]
    if (model) {
      resolve(model.value)
    }
  }, [filteredModels, resolve, selectedIndex])

  const focusInput = useCallback(() => {
    service.setVimMode("insert")
  }, [service])

  const focusList = useCallback(() => {
    service.setVimMode("normal")
  }, [service])

  useDialogKeyboard((key) => {
    const action = resolvePickerKeyboardAction(key, interactionMode)
    switch (action.kind) {
      case "close":
        dismiss()
        return
      case "move":
        setSelectedIndex((current) => {
          const next = current + action.delta
          return Math.max(0, Math.min(next, filteredModels.length - 1))
        })
        return
      case "select":
        handleSelect()
        return
      case "setMode":
        service.setVimMode(action.mode)
        return
      case "none":
        return
    }
  }, dialogId)

  return (
    <box flexDirection="column" width="100%" height={panelHeight}>
      <box paddingBottom={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text>
            <span fg={theme.text}>
              <strong>models</strong>
            </span>
          </text>
          <text>
            <span fg={theme.mutedText}>{filteredModels.length}</span>
          </text>
        </box>
        {!isCompact ? (
          <text>
            <span fg={theme.mutedText}>{truncateEnd(`current ${initialModel}`, 28)}</span>
          </text>
        ) : null}
      </box>

      <box paddingBottom={1} flexShrink={0}>
        <box
          height={3}
          border
          borderStyle="rounded"
          borderColor={isInputFocused ? theme.borderStrong : theme.borderSubtle}
          backgroundColor={theme.surfaceAlt}
          paddingX={1}
          onMouseDown={focusInput}
        >
          <input
            ref={inputRef}
            value={filterText}
            onInput={setFilterText}
            onSubmit={() => {
              handleSelect()
            }}
            onMouseDown={focusInput}
            focused={isInputFocused}
            placeholder="Search models or identifiers"
            backgroundColor={theme.surfaceAlt}
            textColor={theme.text}
            cursorColor={theme.focus}
            placeholderColor={theme.mutedText}
            flexGrow={1}
          />
        </box>
      </box>

      {metadata.status === "loading" ? (
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <LoadingIndicator
            color={theme.warning}
            label="Loading models..."
            textColor={theme.mutedText}
          />
        </box>
      ) : metadata.status === "failed" ? (
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text>
            <span fg={theme.error}>{metadata.message}</span>
          </text>
        </box>
        ) : options.length === 0 ? (
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text>
            <span fg={theme.mutedText}>{emptyMessage}</span>
          </text>
        </box>
      ) : (
        <box
          flexGrow={1}
          minHeight={3}
          overflow="hidden"
          border
          borderStyle="rounded"
          borderColor={isListFocused ? theme.borderStrong : theme.borderSubtle}
          onMouseDown={focusList}
        >
          <select
            options={options}
            selectedIndex={selectedIndex}
            height="100%"
            focused={isListFocused}
            selectedBackgroundColor={theme.selection}
            selectedTextColor={theme.selectionText}
            showScrollIndicator
            onMouseDown={focusList}
            onSelect={(index) => {
              setSelectedIndex(index)
              handleSelect(index)
            }}
          />
        </box>
      )}

      <box height={1} justifyContent="space-between" flexDirection="row">
        <text>
          <span fg={theme.mutedText}>
            {getPickerFooterHint({
              isCompact,
              vimEnabled,
              isListFocused,
              actionLabel: "select",
            })}
          </span>
        </text>
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatModelDescription(model: ModelInfo, maxLength: number): string {
  const description = model.description.trim()
  return truncateEnd(
    description ? `${model.value}  |  ${description}` : model.value,
    maxLength,
  )
}

function truncateEnd(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`
}

function getPickerFooterHint(input: {
  readonly isCompact: boolean
  readonly vimEnabled: boolean
  readonly isListFocused: boolean
  readonly actionLabel: string
}): string {
  const moveLabel = "Up/Down"

  if (!input.vimEnabled) {
    return input.isListFocused
      ? `Results active  ${moveLabel} move  Enter ${input.actionLabel}  Esc close`
      : `Filter active  ${moveLabel} move  Enter ${input.actionLabel}  Esc close`
  }

  if (input.isListFocused) {
    return input.isCompact
      ? `Results active  i filter  j/k move  Enter ${input.actionLabel}`
      : `Results active  i filter  j/k move  Enter ${input.actionLabel}  Esc close`
  }

  return input.isCompact
    ? `Filter active  Esc results  ${moveLabel} move  Enter ${input.actionLabel}`
    : `Filter active  Esc results  ${moveLabel} move  Enter ${input.actionLabel}`
}
