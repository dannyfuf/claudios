import type { SyntaxStyle } from "@opentui/core"
import type { ToolCallDisplayMessage } from "#state/types"
import {
  getFrameBackgroundColor,
  getFrameBorderColor,
  getFrameWidth,
  getStatusToneColor,
  getToolBriefDetail,
  getToolCallDiffFileChange,
  getToolStatusPresentation,
  normalizeToolLabel,
  type MessageLayout,
  type MessagePresentation,
} from "#ui/components/MessageArea.logic"
import { LoadingIndicator } from "#ui/components/LoadingIndicator"
import { MessageFrame } from "#ui/components/messages/MessageFrame"
import { MessageHeader } from "#ui/components/messages/MessageHeader"
import type { ThemePalette } from "#ui/theme"

type ToolCallMessageProps = {
  readonly message: ToolCallDisplayMessage
  readonly presentation: MessagePresentation
  readonly syntaxStyle: SyntaxStyle
  readonly theme: ThemePalette
  readonly layout: MessageLayout
  readonly diffMode: "unified" | "split"
}

export function ToolCallMessage({
  message,
  presentation,
  syntaxStyle,
  theme,
  layout,
  diffMode,
}: ToolCallMessageProps) {
  return (
    <GroupedToolCallMessage
      messages={[message]}
      presentation={presentation}
      syntaxStyle={syntaxStyle}
      theme={theme}
      layout={layout}
      diffMode={diffMode}
    />
  )
}

export function GroupedToolCallMessage({
  messages,
  presentation,
  syntaxStyle,
  theme,
  layout,
  diffMode,
}: {
  readonly messages: readonly ToolCallDisplayMessage[]
  readonly presentation: MessagePresentation
  readonly syntaxStyle: SyntaxStyle
  readonly theme: ThemePalette
  readonly layout: MessageLayout
  readonly diffMode: "unified" | "split"
}) {
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
      <box flexDirection="column">
        {messages.map((message, index) => (
          <ToolCallGroupRow
            key={message.uuid}
            message={message}
            syntaxStyle={syntaxStyle}
            theme={theme}
            diffMode={diffMode}
            marginTop={index === 0 ? 0 : 1}
          />
        ))}
      </box>
    </MessageFrame>
  )
}

function ToolCallGroupRow({
  message,
  syntaxStyle,
  theme,
  diffMode,
  marginTop,
}: {
  readonly message: ToolCallDisplayMessage
  readonly syntaxStyle: SyntaxStyle
  readonly theme: ThemePalette
  readonly diffMode: "unified" | "split"
  readonly marginTop: number
}) {
  const fileChange = getToolCallDiffFileChange(message.toolCall)

  return (
    <box marginTop={marginTop} flexDirection="column">
      <CompactToolRow toolCall={message.toolCall} theme={theme} />
      {fileChange ? (
        <box marginTop={1} flexDirection="column">
          <text>
            <span fg={theme.mutedText}>
              {fileChange.changeType === "added" ? "created" : "modified"} {fileChange.filePath}
            </span>
          </text>
          <box marginTop={1} width="100%">
            <diff
              diff={fileChange.patch}
              view={diffMode}
              showLineNumbers={true}
              syntaxStyle={syntaxStyle}
              wrapMode="none"
            />
          </box>
        </box>
      ) : null}
    </box>
  )
}

export function CompactToolRow({
  toolCall,
  theme,
}: {
  readonly toolCall: ToolCallDisplayMessage["toolCall"]
  readonly theme: ThemePalette
}) {
  const statusPresentation = getToolStatusPresentation(toolCall.status)
  const statusColor = getStatusToneColor(statusPresentation.tone, theme)
  const detail = getToolBriefDetail(toolCall)
  const label = normalizeToolLabel(toolCall.name)

  return (
    <box flexDirection="row" gap={1}>
      <box width={1} minWidth={1} alignItems="center" justifyContent="center">
        {statusPresentation.kind === "spinner" ? (
          <LoadingIndicator color={statusColor} />
        ) : (
          <text>
            <span fg={statusColor}>{statusPresentation.icon}</span>
          </text>
        )}
      </box>
      <text>
        <span fg={theme.text}>{label}</span>
      </text>
      {detail ? (
        <text>
          <span fg={theme.mutedText}>- {detail}</span>
        </text>
      ) : null}
      {toolCall.elapsedSeconds !== null ? (
        <text>
          <span fg={theme.mutedText}>{toolCall.elapsedSeconds.toFixed(1)}s</span>
        </text>
      ) : null}
    </box>
  )
}
