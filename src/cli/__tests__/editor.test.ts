import { describe, expect, it } from "bun:test"
import { resolveEditorCommand, shellQuote } from "#cli/editor"

describe("resolveEditorCommand", () => {
  it("substitutes VISUAL and EDITOR placeholders from the environment", () => {
    expect(
      resolveEditorCommand("$VISUAL --wait", {
        VISUAL: "nvim",
        EDITOR: "vim",
      }),
    ).toBe("nvim --wait")

    expect(
      resolveEditorCommand("$EDITOR --wait", {
        VISUAL: "nvim",
      }),
    ).toBe("nvim --wait")
  })

  it("falls back to vi when no editor environment exists", () => {
    expect(resolveEditorCommand("$EDITOR", {})).toBe("vi")
    expect(resolveEditorCommand("$VISUAL", {})).toBe("vi")
  })
})

describe("shellQuote", () => {
  it("wraps paths in single quotes and escapes embedded quotes", () => {
    expect(shellQuote("/tmp/plain path")).toBe("'/tmp/plain path'")
    expect(shellQuote("/tmp/it's-here")).toBe("'/tmp/it'\\''s-here'")
  })
})
