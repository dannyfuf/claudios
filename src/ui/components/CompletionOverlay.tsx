import { LoadingIndicator } from "#ui/components/LoadingIndicator"
import { VimFocusFrame } from "#ui/components/VimFocusFrame"
import { useThemePalette } from "#ui/hooks"

type CompletionOption = {
  readonly name: string
  readonly description: string
  readonly value: string
}

type CompletionOverlayProps = {
  readonly title: string
  readonly options: readonly CompletionOption[]
  readonly selectedIndex: number
  readonly loading: boolean
  readonly focused: boolean
  readonly onFocusList: () => void
  readonly onSelect: (index: number) => void
}

export function CompletionOverlay(props: CompletionOverlayProps) {
  const theme = useThemePalette()
  if (!props.loading && props.options.length === 0) return null
  const visibleHeight = Math.min(16, props.options.length * 2)

  return (
    <box
      position="absolute"
      left={1}
      right={1}
      bottom={4}
      border
      borderStyle="rounded"
      borderColor={theme.borderStrong}
      backgroundColor={theme.surfaceElevated}
    >
      <box paddingX={1} paddingTop={1} flexDirection="row" justifyContent="space-between">
        <text>
          <span fg={theme.text}>
            <strong>{props.title.toLowerCase()}</strong>
          </span>
        </text>
        {!props.loading ? (
          <text>
            <span fg={theme.mutedText}>{props.options.length}</span>
          </text>
        ) : null}
      </box>
      {props.loading ? (
        <box padding={1} minHeight={4} justifyContent="center" alignItems="center">
          <LoadingIndicator
            color={theme.warning}
            label={`Loading ${props.title.toLowerCase()}...`}
            textColor={theme.mutedText}
          />
        </box>
      ) : (
        <box padding={1}>
          <VimFocusFrame active={props.focused} onMouseDown={props.onFocusList}>
            <select
              options={[...props.options]}
              selectedIndex={props.selectedIndex}
              height={visibleHeight}
              focused={props.focused}
              showScrollIndicator
              selectedBackgroundColor={theme.selection}
              selectedTextColor={theme.selectionText}
              onMouseDown={props.onFocusList}
              onSelect={(index) => {
                props.onSelect(index)
              }}
            />
          </VimFocusFrame>
        </box>
      )}
    </box>
  )
}

export type { CompletionOption }
