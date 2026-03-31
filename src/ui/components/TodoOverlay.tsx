/**
 * TodoOverlayContent — read-only task list overlay.
 *
 * Shows all Claude-managed todo items with their status and content.
 * Opens via Ctrl+T or by clicking the status-bar todo summary.
 * Close with Esc, q, or the [close] action.
 */

import { useTerminalDimensions } from "@opentui/react"
import { useDialogKeyboard } from "@opentui-ui/dialog/react"
import type { DialogId } from "@opentui-ui/dialog/react"
import type { TodoItem } from "#sdk/types"
import { getTodoProgress } from "#ui/components/MessageArea.logic"
import { useThemePalette } from "#ui/hooks"

type TodoOverlayContentProps = {
  readonly items: readonly TodoItem[]
  readonly dismiss: () => void
  readonly dialogId: DialogId
}

const STATUS_ICONS: Record<TodoItem["status"], string> = {
  pending: "○",
  in_progress: "●",
  completed: "✓",
}

type ThemePalette = ReturnType<typeof useThemePalette>

export function TodoOverlayContent({ items, dismiss, dialogId }: TodoOverlayContentProps) {
  const theme = useThemePalette()
  const { height } = useTerminalDimensions()
  const panelHeight = Math.max(10, Math.min(height - 8, 24))

  useDialogKeyboard((key) => {
    if (key.name === "escape" || key.sequence === "q") {
      dismiss()
    }
  }, dialogId)

  const { completedCount, total } = getTodoProgress(items)

  return (
    <box flexDirection="column" width="100%" height={panelHeight}>
      <TodoHeader
        completedCount={completedCount}
        total={total}
        theme={theme}
        onClose={dismiss}
      />
      {items.length === 0 ? (
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text>
            <span fg={theme.mutedText}>No tasks.</span>
          </text>
        </box>
      ) : (
        <scrollbox flexGrow={1}>
          {items.map((item, index) => (
            <TodoItemRow
              key={index}
              item={item}
              index={index}
              theme={theme}
            />
          ))}
        </scrollbox>
      )}
      <box paddingTop={1}>
        <text>
          <span fg={theme.mutedText}>Esc / q close</span>
        </text>
      </box>
    </box>
  )
}

function TodoHeader(props: {
  readonly completedCount: number
  readonly total: number
  readonly theme: ThemePalette
  readonly onClose: () => void
}) {
  const { completedCount, total, theme, onClose } = props
  const progressText = total > 0 ? `${completedCount}/${total}` : "0"

  return (
    <box paddingBottom={1} flexDirection="row" justifyContent="space-between">
      <box flexDirection="row" gap={1}>
        <text>
          <span fg={theme.text}>
            <strong>task list</strong>
          </span>
        </text>
        <text>
          <span fg={theme.mutedText}>{progressText} done</span>
        </text>
      </box>
      <text onMouseDown={onClose}>
        <span fg={theme.mutedText}>[close]</span>
      </text>
    </box>
  )
}

function TodoItemRow(props: {
  readonly item: TodoItem
  readonly index: number
  readonly theme: ThemePalette
}) {
  const { item, index, theme } = props

  const icon = STATUS_ICONS[item.status]
  const iconColor =
    item.status === "completed"
      ? theme.success
      : item.status === "in_progress"
        ? theme.primary
        : theme.mutedText

  const contentColor = item.status === "completed" ? theme.mutedText : theme.text

  return (
    <box flexDirection="column" paddingBottom={item.activeForm ? 0 : 0}>
      <box flexDirection="row" gap={1}>
        <text>
          <span fg={theme.mutedText}>{String(index + 1).padStart(2)}.</span>
        </text>
        <text>
          <span fg={iconColor}>{icon}</span>
        </text>
        <text>
          <span fg={contentColor}>{item.content}</span>
        </text>
      </box>
      {item.activeForm && item.status === "in_progress" ? (
        <box paddingLeft={5}>
          <text>
            <span fg={theme.mutedText}>{item.activeForm}</span>
          </text>
        </box>
      ) : null}
    </box>
  )
}
