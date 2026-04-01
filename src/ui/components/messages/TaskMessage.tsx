import type { TaskDisplayMessage, ToolCallDisplayMessage } from "#state/types"
import {
  formatTaskUsage,
  getFrameBackgroundColor,
  getFrameBorderColor,
  getFrameWidth,
  getTaskDetailLine,
  type MessageLayout,
  type MessagePresentation,
} from "#ui/components/MessageArea.logic"
import { MessageFrame } from "#ui/components/messages/MessageFrame"
import { MessageHeader } from "#ui/components/messages/MessageHeader"
import { CompactToolRow } from "#ui/components/messages/ToolCallMessage"
import type { ThemePalette } from "#ui/theme"

type TaskMessageProps = {
  readonly message: TaskDisplayMessage
  readonly presentation: MessagePresentation
  readonly theme: ThemePalette
  readonly layout: MessageLayout
  readonly activeToolCalls: readonly ToolCallDisplayMessage["toolCall"][]
}

export function TaskMessage({
  message,
  presentation,
  theme,
  layout,
  activeToolCalls,
}: TaskMessageProps) {
  const detailLine = getTaskDetailLine(message.task)
  const usageLine = formatTaskUsage(message.task.usage)
  const visibleActiveToolCalls = message.task.status === "running" ? activeToolCalls : []

  return (
    <MessageFrame
      align={presentation.frame.alignment}
      backgroundColor={getFrameBackgroundColor(presentation.frame.surface, theme)}
      borderColor={getFrameBorderColor(presentation, theme)}
      horizontalPadding={layout.horizontalPadding}
      maxWidth={layout.columnWidth}
      paddingX={1}
      paddingY={layout.sectionPaddingY}
      width={getFrameWidth(presentation, layout)}
    >
      <MessageHeader
        compact={layout.compact}
        marginBottom={layout.metaGapBottom}
        model={presentation.header}
        theme={theme}
      />
      <text>
        <span fg={theme.text}>{message.task.description}</span>
      </text>
      {detailLine ? (
        <box marginTop={1}>
          <text>
            <span fg={theme.mutedText}>{detailLine}</span>
          </text>
        </box>
      ) : null}
      {visibleActiveToolCalls.length > 0 ? (
        <box marginTop={1} flexDirection="column">
          <text>
            <span fg={theme.mutedText}>live tools</span>
          </text>
          {visibleActiveToolCalls.map((toolCall) => (
            <CompactToolRow key={toolCall.id} toolCall={toolCall} theme={theme} />
          ))}
        </box>
      ) : null}
      {usageLine ? (
        <box marginTop={1}>
          <text>
            <span fg={theme.mutedText}>{usageLine}</span>
          </text>
        </box>
      ) : null}
    </MessageFrame>
  )
}
