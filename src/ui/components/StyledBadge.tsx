/**
 * StyledBadge — variant-based Badge using `@opentui-ui/react` styled() API.
 *
 * Replaces the hand-rolled Chip component with ghost, outline, and solid
 * variants. Colors are passed via inline `styles` prop since they come from
 * the dynamic theme palette.
 *
 * For bold (strong) labels, use the <AppBadge> wrapper instead — Badge's
 * root slot does not support text formatting attributes directly.
 */

import { useMemo } from "react"
import { styled } from "@opentui-ui/react/styled"
import { Badge } from "@opentui-ui/react/badge"
import type { BadgeSlotStyles } from "@opentui-ui/core/badge"

export const StyledBadge = styled(Badge, {
  base: {
    root: { paddingX: 1, paddingY: 0 },
  },
  variants: {
    variant: {
      ghost: {
        root: {},
      },
      outline: {
        root: {},
      },
      solid: {
        root: {},
      },
    },
  },
  defaultVariants: { variant: "ghost" },
})

/**
 * Application-level badge that wraps StyledBadge and adds `strong` support.
 *
 * When `strong` is true, falls back to a manual `<box>` + `<text>` + `<strong>`
 * rendering since the Badge renderable doesn't expose text formatting.
 * When `strong` is false/undefined, delegates to StyledBadge directly.
 */
type AppBadgeProps = {
  readonly label: string
  readonly textColor: string
  readonly backgroundColor?: string
  readonly borderColor?: string
  readonly strong?: boolean
  readonly variant?: "ghost" | "outline" | "solid"
}

export function AppBadge(props: AppBadgeProps) {
  const { label, textColor, backgroundColor, variant = "ghost", strong } = props

  const styles = useMemo<BadgeSlotStyles>(
    () => ({
      root: {
        color: textColor,
        ...(backgroundColor ? { backgroundColor } : {}),
      },
    }),
    [textColor, backgroundColor],
  )

  if (strong) {
    // Badge can't render bold text, so fall back to manual rendering
    return (
      <box paddingX={1} minWidth={0} {...(backgroundColor ? { backgroundColor } : {})}>
        <text>
          <span fg={textColor}>
            <strong>{label}</strong>
          </span>
        </text>
      </box>
    )
  }

  return <StyledBadge label={label} variant={variant} styles={styles} />
}
