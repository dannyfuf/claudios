import type { ReactNode } from "react"
import { useThemePalette } from "#ui/hooks"

type VimFocusFrameProps = {
  readonly active: boolean
  readonly children: ReactNode
  readonly backgroundColor?: string
  readonly flexGrow?: number
  readonly height?: number | "auto" | `${number}%`
  readonly minHeight?: number | "auto" | `${number}%`
  readonly onMouseDown?: () => void
  readonly overflow?: "hidden" | "scroll" | "visible"
  readonly paddingX?: number | `${number}%`
}

export function VimFocusFrame(props: VimFocusFrameProps) {
  const {
    active,
    backgroundColor,
    children,
    flexGrow,
    height,
    minHeight,
    onMouseDown,
    overflow,
    paddingX,
  } = props
  const theme = useThemePalette()

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={active ? theme.borderStrong : theme.borderSubtle}
      {...(backgroundColor === undefined ? {} : { backgroundColor })}
      {...(flexGrow === undefined ? {} : { flexGrow })}
      {...(height === undefined ? {} : { height })}
      {...(minHeight === undefined ? {} : { minHeight })}
      {...(onMouseDown === undefined ? {} : { onMouseDown })}
      {...(overflow === undefined ? {} : { overflow })}
      {...(paddingX === undefined ? {} : { paddingX })}
    >
      {children}
    </box>
  )
}
