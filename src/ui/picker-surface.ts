import { useCallback, useState } from "react"
import type { InteractionMode } from "#state/types"
import { useConversationSelector, useConversationService } from "#ui/hooks"
import { matchesInteractionMode, useInteractionMode } from "#ui/vim-mode"

export type PickerTarget = "input" | "list"

export function getInputListSurfaceTarget(input: {
  readonly vimEnabled: boolean
  readonly interactionMode: InteractionMode
  readonly plainTarget: PickerTarget
}): PickerTarget {
  if (!input.vimEnabled) {
    return input.plainTarget
  }

  return matchesInteractionMode(input.interactionMode, "normal") ? "list" : "input"
}

export function useVimInputListSurface() {
  const service = useConversationService()
  const vimEnabled = useConversationSelector((state) => state.vimEnabled)
  const interactionMode = useInteractionMode()
  const [plainTarget, setPlainTarget] = useState<PickerTarget>("input")

  const activeTarget = getInputListSurfaceTarget({
    vimEnabled,
    interactionMode,
    plainTarget,
  })

  const focusInput = useCallback(() => {
    if (vimEnabled) {
      service.setVimMode("insert")
      return
    }

    setPlainTarget("input")
  }, [service, vimEnabled])

  const focusList = useCallback(() => {
    if (vimEnabled) {
      service.setVimMode("normal")
      return
    }

    setPlainTarget("list")
  }, [service, vimEnabled])

  return {
    activeTarget,
    isInputActive: activeTarget === "input",
    isListActive: activeTarget === "list",
    focusInput,
    focusList,
  }
}
