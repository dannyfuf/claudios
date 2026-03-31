import type { SpinnerOptions } from "opentui-spinner"
import "opentui-spinner/react"

type LoadingIndicatorProps = {
  readonly color: string
  readonly label?: string
  readonly textColor?: string
  readonly name?: SpinnerOptions["name"]
}

export function LoadingIndicator({
  color,
  label,
  textColor = color,
  name = "arc",
}: LoadingIndicatorProps) {
  return (
    <box flexDirection="row" alignItems="center" gap={label ? 1 : 0}>
      <box width={1} minWidth={1} alignItems="center" justifyContent="center">
        <spinner name={name} color={color} />
      </box>
      {label ? (
        <text>
          <span fg={textColor}>{label}</span>
        </text>
      ) : null}
    </box>
  )
}
