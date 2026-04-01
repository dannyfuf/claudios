import { useState } from "react"
import type { SyntaxStyle } from "@opentui/core"
import type {
  AssistantDisplayMessage,
  ErrorDisplayMessage,
  SystemDisplayMessage,
  ThinkingDisplayMessage,
  UserDisplayMessage,
  UserSlashCommandMeta,
} from "#state/types"
import {
  getFrameBackgroundColor,
  getFrameBorderColor,
  getFrameWidth,
  type MessageLayout,
  type MessagePresentation,
} from "#ui/components/MessageArea.logic"
import { MessageFrame } from "#ui/components/messages/MessageFrame"
import { MessageHeader } from "#ui/components/messages/MessageHeader"
import type { ThemePalette } from "#ui/theme"

type SharedMessageProps = {
  readonly presentation: MessagePresentation
  readonly theme: ThemePalette
  readonly layout: MessageLayout
}

export function UserMessage({
  message,
  presentation,
  theme,
  layout,
}: SharedMessageProps & { readonly message: UserDisplayMessage }) {
  const slashCommand: UserSlashCommandMeta | undefined = message.slashCommand
  const hasSlashCommand = slashCommand != null
  const hasDescription = hasSlashCommand && slashCommand.description !== ""
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)

  return (
    <MessageFrame
      align={presentation.frame.alignment}
      backgroundColor={getFrameBackgroundColor(presentation.frame.surface, theme)}
      borderColor={getFrameBorderColor(presentation, theme)}
      horizontalPadding={layout.horizontalPadding}
      maxWidth={layout.columnWidth}
      paddingX={layout.compact ? 1 : 2}
      paddingY={layout.sectionPaddingY}
      width={getFrameWidth(presentation, layout)}
    >
      <MessageHeader
        compact={layout.compact}
        marginBottom={layout.metaGapBottom}
        model={presentation.header}
        theme={theme}
      />
      {/* Slash command badge */}
      {hasSlashCommand && (
        <text>
          <span fg={theme.primary}>{"/ "}</span>
          <b fg={theme.text}>{slashCommand.commandName}</b>
        </text>
      )}
      {/* Clickable toggle — shows/hides the command description */}
      {hasDescription && (
        <box onMouseDown={() => setDescriptionExpanded((v) => !v)}>
          <text>
            <span fg={theme.mutedText}>
              {descriptionExpanded ? "▾ hide description" : "▸ show description"}
            </span>
          </text>
        </box>
      )}
      {/* Command description — shown only when expanded */}
      {hasDescription && descriptionExpanded && (
        <text>
          <span fg={theme.mutedText}>{slashCommand.description}</span>
        </text>
      )}
      {/* User's prompt text — always visible */}
      {hasSlashCommand
        ? slashCommand.args !== "" && (
            <text>
              <span fg={theme.text}>{slashCommand.args}</span>
            </text>
          )
        : (
            <text>
              <span fg={theme.text}>{message.text}</span>
            </text>
          )}
    </MessageFrame>
  )
}

export function AssistantMessage({
  message,
  presentation,
  syntaxStyle,
  theme,
  layout,
}: SharedMessageProps & {
  readonly message: AssistantDisplayMessage
  readonly syntaxStyle: SyntaxStyle
}) {
  const hasText = message.text.trim().length > 0

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
        marginBottom={hasText ? layout.metaGapBottom : 0}
        model={presentation.header}
        theme={theme}
      />
      {hasText ? (
        <box>
          <markdown
            content={message.text}
            streaming={message.isStreaming}
            syntaxStyle={syntaxStyle}
          />
        </box>
      ) : null}
    </MessageFrame>
  )
}

export function ThinkingMessage({
  message,
  presentation,
  theme,
  layout,
}: SharedMessageProps & { readonly message: ThinkingDisplayMessage }) {
  const thinkingLines = message.text.split("\n")

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
      <box paddingLeft={layout.compact ? 1 : 2} flexDirection="column">
        {thinkingLines.map((line, index) => (
          <text key={`${message.uuid}:${index}`}>
            <span fg={theme.mutedText}>
              <em>{line}</em>
            </span>
          </text>
        ))}
      </box>
    </MessageFrame>
  )
}

export function SystemMessage({
  message,
  presentation,
  theme,
  layout,
}: SharedMessageProps & { readonly message: SystemDisplayMessage }) {
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
        <span fg={theme.mutedText}>{message.text}</span>
      </text>
    </MessageFrame>
  )
}

export function ErrorMessage({
  message,
  presentation,
  theme,
  layout,
}: SharedMessageProps & { readonly message: ErrorDisplayMessage }) {
  return (
    <MessageFrame
      align={presentation.frame.alignment}
      backgroundColor={getFrameBackgroundColor(presentation.frame.surface, theme)}
      borderColor={getFrameBorderColor(presentation, theme)}
      horizontalPadding={layout.horizontalPadding}
      maxWidth={layout.columnWidth}
      paddingX={layout.compact ? 1 : 2}
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
        <span fg={theme.error}>{message.text}</span>
      </text>
    </MessageFrame>
  )
}
