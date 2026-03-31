import { describe, expect, it } from "bun:test"
import { Keymap } from "#commands/keymap"

describe("Keymap", () => {
  it("resolves ? in normal mode to keybinding help", () => {
    const keymap = new Keymap()

    expect(keymap.resolve("?", "global", "normal")).toBe("keys.help")
    expect(keymap.resolve("?", "global", "insert")).toBeNull()
  })

  it("resolves the model and session picker shortcuts in global mode", () => {
    const keymap = new Keymap()

    expect(keymap.resolve("ctrl+p", "global", "insert")).toBe("model.openPicker")
    expect(keymap.resolve("ctrl+r", "global", "insert")).toBe("session.openPicker")
    expect(keymap.resolve("ctrl+p", "global", "normal")).toBe("model.openPicker")
    expect(keymap.resolve("ctrl+r", "global", "normal")).toBe("session.openPicker")
  })

  it("applies action-based key overrides to picker shortcuts", () => {
    const keymap = new Keymap({
      "model.openPicker": "alt+m",
      "session.openPicker": "alt+r",
    })

    expect(keymap.resolve("alt+m", "global", "insert")).toBe("model.openPicker")
    expect(keymap.resolve("alt+r", "global", "insert")).toBe("session.openPicker")
    expect(keymap.resolve("ctrl+p", "global", "insert")).toBeNull()
    expect(keymap.resolve("ctrl+r", "global", "insert")).toBeNull()
  })
})
