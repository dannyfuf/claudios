import type { KeyEvent } from "@opentui/core"
import type { VimMode } from "#state/types"

export type PickerKeyboardAction =
  | { readonly kind: "none" }
  | { readonly kind: "close" }
  | { readonly kind: "move"; readonly delta: -1 | 1 }
  | { readonly kind: "select" }
  | { readonly kind: "setMode"; readonly mode: VimMode }

export function resolvePickerKeyboardAction(
  key: Pick<KeyEvent, "name" | "sequence">,
  vimMode: VimMode,
): PickerKeyboardAction {
  if (key.name === "enter" || key.name === "return") {
    return { kind: "select" }
  }

  if (key.name === "down" || (vimMode === "normal" && key.sequence === "j")) {
    return { kind: "move", delta: 1 }
  }

  if (key.name === "up" || (vimMode === "normal" && key.sequence === "k")) {
    return { kind: "move", delta: -1 }
  }

  if (key.name === "escape") {
    return vimMode === "insert"
      ? { kind: "setMode", mode: "normal" }
      : { kind: "close" }
  }

  if (vimMode === "normal" && key.sequence === "i") {
    return { kind: "setMode", mode: "insert" }
  }

  return { kind: "none" }
}
