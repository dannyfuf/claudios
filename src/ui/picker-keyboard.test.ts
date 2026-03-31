import { describe, expect, it } from "bun:test"
import { resolvePickerKeyboardAction } from "#ui/picker-keyboard"

describe("resolvePickerKeyboardAction", () => {
  it("keeps insert mode focused on filtering until escape is pressed", () => {
    expect(resolvePickerKeyboardAction({ name: "j", sequence: "j" }, "insert")).toEqual({ kind: "none" })
    expect(resolvePickerKeyboardAction({ name: "escape", sequence: "\u001b" }, "insert")).toEqual({
      kind: "setMode",
      mode: "normal",
    })
  })

  it("supports normal-mode navigation and returning to insert", () => {
    expect(resolvePickerKeyboardAction({ name: "j", sequence: "j" }, "normal")).toEqual({
      kind: "move",
      delta: 1,
    })
    expect(resolvePickerKeyboardAction({ name: "k", sequence: "k" }, "normal")).toEqual({
      kind: "move",
      delta: -1,
    })
    expect(resolvePickerKeyboardAction({ name: "i", sequence: "i" }, "normal")).toEqual({
      kind: "setMode",
      mode: "insert",
    })
  })

  it("keeps enter and arrow keys working in both modes", () => {
    expect(resolvePickerKeyboardAction({ name: "down", sequence: "" }, "insert")).toEqual({
      kind: "move",
      delta: 1,
    })
    expect(resolvePickerKeyboardAction({ name: "up", sequence: "" }, "normal")).toEqual({
      kind: "move",
      delta: -1,
    })
    expect(resolvePickerKeyboardAction({ name: "enter", sequence: "\r" }, "normal")).toEqual({ kind: "select" })
    expect(resolvePickerKeyboardAction({ name: "return", sequence: "\r" }, "normal")).toEqual({ kind: "select" })
    expect(resolvePickerKeyboardAction({ name: "escape", sequence: "\u001b" }, "normal")).toEqual({ kind: "close" })
  })
})
