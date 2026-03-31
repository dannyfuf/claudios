import type { ReactNode } from "react"

type MessageFrameProps = {
  readonly align: "left" | "right"
  readonly backgroundColor: string | undefined
  readonly borderColor: string
  readonly children: ReactNode
  readonly horizontalPadding: number
  readonly maxWidth: number
  readonly paddingX: number
  readonly paddingY: number
  readonly width: number | "100%"
}

export function MessageFrame({
  align,
  backgroundColor,
  borderColor,
  children,
  horizontalPadding,
  maxWidth,
  paddingX,
  paddingY,
  width,
}: MessageFrameProps) {
  return (
    <box paddingX={horizontalPadding} marginBottom={1} alignItems="center">
      <box
        width="100%"
        maxWidth={maxWidth}
        flexDirection="column"
        alignItems={align === "right" ? "flex-end" : "stretch"}
      >
        <box
          width={width}
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={borderColor}
          {...(backgroundColor === undefined ? {} : { backgroundColor })}
          paddingX={paddingX}
          paddingY={paddingY}
        >
          {children}
        </box>
      </box>
    </box>
  )
}
