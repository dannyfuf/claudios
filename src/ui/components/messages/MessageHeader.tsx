import { LoadingIndicator } from "#ui/components/LoadingIndicator"
import type { MessageHeaderModel, MessageHeaderTone } from "#ui/components/MessageArea.logic"
import type { ThemePalette } from "#ui/theme"

type MessageHeaderProps = {
  readonly compact: boolean
  readonly marginBottom?: number
  readonly model: MessageHeaderModel
  readonly theme: ThemePalette
}

export function MessageHeader({ compact, marginBottom = 0, model, theme }: MessageHeaderProps) {
  const labelColor = getHeaderToneColor(model.labelTone, theme)
  const streamingColor = model.streamingTone
    ? getHeaderToneColor(model.streamingTone, theme)
    : null

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      gap={1}
      marginBottom={marginBottom}
    >
      <box flexDirection="row" gap={1} minWidth={0}>
        {model.indicator ? (
          <box width={1} minWidth={1} alignItems="center" justifyContent="center">
            {model.indicator.kind === "spinner" ? (
              <LoadingIndicator color={getHeaderToneColor(model.indicator.tone, theme)} />
            ) : (
              <text>
                <span fg={getHeaderToneColor(model.indicator.tone, theme)}>{model.indicator.icon}</span>
              </text>
            )}
          </box>
        ) : null}
        <text>
          <span fg={labelColor}>
            {model.labelEmphasis === "strong" ? <strong>{model.label}</strong> : model.label}
          </span>
        </text>
        {model.contextLabel ? (
          <text>
            <span fg={theme.mutedText}>{model.contextLabel}</span>
          </text>
        ) : null}
      </box>
      <box flexDirection="row" gap={1}>
        <text>
          <span fg={theme.mutedText}>{model.timestamp}</span>
        </text>
        {streamingColor ? (
          <text>
            <span fg={streamingColor}>
              {model.streamingTone === "primary" ? (
                <strong>{compact ? "live" : "streaming"}</strong>
              ) : (
                compact ? "live" : "streaming"
              )}
            </span>
          </text>
        ) : null}
      </box>
    </box>
  )
}

function getHeaderToneColor(tone: MessageHeaderTone, theme: ThemePalette): string {
  switch (tone) {
    case "muted":
      return theme.mutedText
    case "warning":
      return theme.warning
    case "success":
      return theme.success
    case "error":
      return theme.error
    case "primary":
      return theme.primary
  }
}
