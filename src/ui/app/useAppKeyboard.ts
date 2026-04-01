import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { InputRenderable, KeyEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { normalizeKeyBinding, type Keymap } from "#commands/keymap"
import { resolvePickerKeyboardAction } from "#ui/picker-keyboard"
import type { Picker } from "#ui/app/picker-state"
import { handleNormalModeKey, type VimPendingOperator } from "#ui/vim"
import { matchesInteractionMode } from "#ui/vim-mode"
import type { ConversationState, InteractionMode } from "#state/types"

const ESCAPE_INTERRUPT_WINDOW_MS = 500

type KeyboardService = {
  readonly setPromptText: (text: string) => void
  readonly setVimMode: (mode: ConversationState["vimMode"]) => void
}

export type UseAppKeyboardOptions = {
  readonly clearPendingEscapeInterrupt: () => void
  readonly handleAction: (action: string) => void
  readonly inputRef: MutableRefObject<InputRenderable | null>
  readonly interruptRunningRequest: () => void
  readonly interactionMode: InteractionMode
  readonly isDialogOpen: boolean
  readonly isNormalInteractionMode: boolean
  readonly keymap: Keymap
  readonly pendingEscapeInterruptRef: MutableRefObject<number | null>
  readonly pendingOperator: VimPendingOperator
  readonly picker: Picker | null
  readonly promptText: string
  readonly selectedIndex: number
  readonly selectPickerOption: (index: number) => void
  readonly service: KeyboardService
  readonly sessionState: ConversationState["sessionState"]
  readonly setPendingOperator: Dispatch<SetStateAction<VimPendingOperator>>
  readonly setSelectedIndex: Dispatch<SetStateAction<number>>
  readonly syncPromptTextFromInput: () => void
  readonly vimEnabled: boolean
}

export function useAppKeyboard(options: UseAppKeyboardOptions): void {
  useKeyboard((key) => {
    if (options.isDialogOpen && options.sessionState.status !== "awaiting_permission") {
      return
    }

    if (options.sessionState.status === "running" && !isEscapeKey(key)) {
      options.clearPendingEscapeInterrupt()
    }

    const keyStr = normalizeKeyBinding(getKeyBindingString(key))
    if (
      key.repeated
      && (keyStr === "?" || keyStr === "ctrl+/")
      && matchesInteractionMode(options.interactionMode, ["normal", "plain"] as const)
    ) {
      return
    }

    const context = options.sessionState.status === "awaiting_permission" ? "modal" as const : "global" as const
    const action = options.keymap.resolve(keyStr, context, options.interactionMode)
    const shouldSyncPromptText = shouldSyncPromptTextFromKey(key)

    if (options.sessionState.status !== "awaiting_permission") {
      const keyConsumedByAction = action !== null && shouldSyncPromptText
      if (!options.isNormalInteractionMode && shouldSyncPromptText && !keyConsumedByAction) {
        queueMicrotask(options.syncPromptTextFromInput)
      }

      if (keyConsumedByAction && !options.isNormalInteractionMode) {
        queueMicrotask(() => {
          if (options.inputRef.current) {
            options.inputRef.current.value = options.promptText
          }
        })
      }

      if (options.picker) {
        const picker = options.picker
        const pickerAction = resolvePickerKeyboardAction(key, options.interactionMode)
        switch (pickerAction.kind) {
          case "move":
            options.clearPendingEscapeInterrupt()
            options.setSelectedIndex((current) => {
              const next = current + pickerAction.delta
              const maxIndex = picker.options.length - 1
              return Math.max(0, Math.min(next, maxIndex))
            })
            return
          case "select":
            options.clearPendingEscapeInterrupt()
            if (!options.isNormalInteractionMode) {
              return
            }

            if (!picker.options[options.selectedIndex]) {
              return
            }

            options.selectPickerOption(options.selectedIndex)
            return
          case "close":
            if (options.isNormalInteractionMode && options.vimEnabled) {
              options.clearPendingEscapeInterrupt()
              options.service.setVimMode("insert")
              return
            }
            break
          case "setMode":
            options.clearPendingEscapeInterrupt()
            options.service.setVimMode(pickerAction.mode)
            return
          case "none":
            break
        }

        if (action === "plan.toggle") {
          return
        }
      }

      if (options.isNormalInteractionMode && !options.picker) {
        if (key.name === "escape" && options.pendingOperator !== null) {
          options.clearPendingEscapeInterrupt()
          options.setPendingOperator(null)
          return
        }

        if (isPromptTriggerKey(key, "/")) {
          options.clearPendingEscapeInterrupt()
          options.setPendingOperator(null)
          options.service.setPromptText("/")
          options.service.setVimMode("insert")
          return
        }

        const vimResult = handleNormalModeKey(options.inputRef.current, key, options.pendingOperator)
        if (vimResult.handled) {
          options.clearPendingEscapeInterrupt()
          options.setPendingOperator(vimResult.nextOperator)
          options.syncPromptTextFromInput()
          if (vimResult.enterInsertMode) {
            options.service.setVimMode("insert")
          }
          return
        }
      }
    }

    if (action) {
      options.clearPendingEscapeInterrupt()
      options.handleAction(action)
      return
    }

    if (options.sessionState.status !== "running") {
      return
    }

    if (isDoubleEscapeKey(key)) {
      options.clearPendingEscapeInterrupt()
      options.interruptRunningRequest()
      return
    }

    if (isEscapeKey(key) && !key.repeated) {
      const now = Date.now()
      const previousEscapeAt = options.pendingEscapeInterruptRef.current

      if (previousEscapeAt !== null && now - previousEscapeAt <= ESCAPE_INTERRUPT_WINDOW_MS) {
        options.clearPendingEscapeInterrupt()
        options.interruptRunningRequest()
        return
      }

      options.pendingEscapeInterruptRef.current = now
    }
  })
}

function getKeyBindingString(key: KeyEvent): string {
  if (!key.ctrl && !key.meta && isPrintableKeySequence(key.sequence)) {
    return key.sequence
  }

  const parts: string[] = []
  if (key.ctrl) {
    parts.push("ctrl")
  }
  if (key.meta) {
    parts.push("alt")
  }
  if (key.shift && key.name.length > 1) {
    parts.push("shift")
  }
  parts.push(key.name)
  return parts.join("+")
}

function isPrintableKeySequence(sequence: string): boolean {
  return sequence.length === 1 && sequence >= " " && sequence <= "~"
}

function isPromptTriggerKey(key: KeyEvent, expected: "/"): boolean {
  return key.name === expected || key.sequence === expected
}

function shouldSyncPromptTextFromKey(
  key: Pick<KeyEvent, "name" | "sequence" | "ctrl" | "meta">,
): boolean {
  if (key.ctrl || key.meta) {
    return false
  }

  return isPrintableKeySequence(key.sequence) || key.name === "backspace" || key.name === "delete"
}

function isEscapeKey(key: Pick<KeyEvent, "name">): boolean {
  return key.name === "escape"
}

function isDoubleEscapeKey(key: Pick<KeyEvent, "name" | "meta">): boolean {
  return isEscapeKey(key) && key.meta
}
