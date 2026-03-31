/**
 * SessionPickerDialogContent — self-contained content rendered inside
 * a dialog.prompt<string>() for selecting a session to resume.
 *
 * Loads sessions on mount via ConversationService.listSessionSummaries().
 * Manages its own filter text, selected index, loading, and error state.
 * Keyboard handling is scoped via useDialogKeyboard.
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
import type { SessionSummary } from "#sdk/types"
import { LoadingIndicator } from "#ui/components/LoadingIndicator"
import { useConversationSelector, useConversationService, useDebouncedValue, useThemePalette } from "#ui/hooks"
import { resolvePickerKeyboardAction } from "#ui/picker-keyboard"

type SessionPickerDialogContentProps = {
  readonly resolve: (value: string) => void
  readonly dismiss: () => void
  readonly dialogId: DialogId
}

export function SessionPickerDialogContent(props: SessionPickerDialogContentProps) {
  const { resolve, dismiss, dialogId } = props
  const theme = useThemePalette()
  const service = useConversationService()
  const { width, height } = useTerminalDimensions()
  const vimMode = useConversationSelector((s) => s.vimMode)

  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [filterText, setFilterText] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const inputRef = useRef<InputRenderable | null>(null)
  const debouncedFilterText = useDebouncedValue(filterText, 120)

  const isCompact = width < 96
  // Dialog auto-sizes height to content — set explicit height so the
  // select list has room to grow. Subtract 8 for dialog chrome (border +
  // padding) and centering margin.
  const panelHeight = Math.max(12, Math.min(height - 8, 24))

  // Load sessions on mount
  useEffect(() => {
    let cancelled = false

    void service
      .listSessionSummaries()
      .then((summaries) => {
        if (!cancelled) {
          setSessions(summaries)
          setLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : String(error))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [service])

  const filteredSessions = useMemo(() => {
    if (!debouncedFilterText.trim()) return sessions
    const query = debouncedFilterText.toLowerCase()
    return sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(query) ||
        (session.cwd?.toLowerCase().includes(query) ?? false) ||
        (session.gitBranch?.toLowerCase().includes(query) ?? false),
    )
  }, [debouncedFilterText, sessions])

  const options = useMemo(
    () =>
      filteredSessions.map((session) => ({
        name: truncateEnd(session.title, isCompact ? 24 : 36),
        description: formatSessionDescription(session, isCompact ? 40 : 60),
        value: session.id,
      })),
    [filteredSessions, isCompact],
  )

  const isInputFocused = vimMode === "insert"

  // Reset selected index when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [debouncedFilterText])

  const handleSelect = useCallback(() => {
    const session = filteredSessions[selectedIndex]
    if (session) {
      resolve(session.id)
    }
  }, [filteredSessions, resolve, selectedIndex])

  useDialogKeyboard((key) => {
    const action = resolvePickerKeyboardAction(key, vimMode)
    switch (action.kind) {
      case "close":
        dismiss()
        return
      case "move":
        setSelectedIndex((current) => {
          const next = current + action.delta
          return Math.max(0, Math.min(next, filteredSessions.length - 1))
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
        <text>
          <span fg={theme.text}>
            <strong>sessions</strong>
          </span>
        </text>
        <text>
          <span fg={theme.mutedText}>{filteredSessions.length}</span>
        </text>
      </box>

      <box paddingBottom={1} flexShrink={0}>
        <box
          height={3}
          border
          borderStyle="rounded"
          borderColor={theme.borderSubtle}
          backgroundColor={theme.surfaceAlt}
          paddingX={1}
        >
          <input
            ref={inputRef}
            value={filterText}
            onChange={setFilterText}
            onSubmit={handleSelect}
            focused={isInputFocused}
            placeholder="Search sessions, cwd, or branch"
            backgroundColor={theme.surfaceAlt}
            textColor={theme.text}
            cursorColor={theme.focus}
            placeholderColor={theme.mutedText}
            flexGrow={1}
          />
        </box>
      </box>

      {loading ? (
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <LoadingIndicator
            color={theme.warning}
            label="Loading sessions..."
            textColor={theme.mutedText}
          />
        </box>
      ) : options.length === 0 ? (
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text>
            <span fg={errorMessage ? theme.error : theme.mutedText}>
              {errorMessage ?? "No matching sessions"}
            </span>
          </text>
        </box>
      ) : (
        <>
          {errorMessage ? (
            <box paddingBottom={1}>
              <box
                border
                borderStyle="rounded"
                borderColor={theme.borderSubtle}
                backgroundColor={theme.surfaceAlt}
                paddingX={1}
              >
                <text>
                  <span fg={theme.error}>{errorMessage}</span>
                </text>
              </box>
            </box>
          ) : null}

          <box flexGrow={1} minHeight={3} overflow="hidden">
            <select
              options={options}
              selectedIndex={selectedIndex}
              height="100%"
              focused={false}
              selectedBackgroundColor={theme.selection}
              selectedTextColor={theme.selectionText}
              showScrollIndicator
              onSelect={() => {
                return
              }}
            />
          </box>
        </>
      )}

      <box height={1} justifyContent="space-between" flexDirection="row">
        <text>
          <span fg={theme.mutedText}>
            {isCompact
              ? "i filter  j/k move  Enter resume  Esc close"
              : "Insert filters  Normal j/k move  Enter resume  Esc back/close"}
          </span>
        </text>
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSessionDescription(session: SessionSummary, maxLength: number): string {
  const details = [formatDate(session.lastModified)]

  if (session.gitBranch) {
    details.push(truncateEnd(session.gitBranch, 18))
  }

  if (session.cwd) {
    details.push(truncateMiddle(session.cwd, 26))
  }

  return truncateEnd(details.join("  |  "), maxLength)
}

function formatDate(date: Date): string {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
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
