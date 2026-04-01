import { describe, expect, it } from "bun:test"
import { getInputListSurfaceTarget } from "#ui/picker-surface"

describe("getInputListSurfaceTarget", () => {
  it("uses the local target when vim mode is disabled", () => {
    expect(
      getInputListSurfaceTarget({
        vimEnabled: false,
        interactionMode: "plain",
        plainTarget: "input",
      }),
    ).toBe("input")

    expect(
      getInputListSurfaceTarget({
        vimEnabled: false,
        interactionMode: "plain",
        plainTarget: "list",
      }),
    ).toBe("list")
  })

  it("keeps the input active in plain and insert interaction modes", () => {
    expect(
      getInputListSurfaceTarget({
        vimEnabled: true,
        interactionMode: "plain",
        plainTarget: "list",
      }),
    ).toBe("input")

    expect(
      getInputListSurfaceTarget({
        vimEnabled: true,
        interactionMode: "insert",
        plainTarget: "list",
      }),
    ).toBe("input")
  })

  it("switches the active target to the list in normal mode", () => {
    expect(
      getInputListSurfaceTarget({
        vimEnabled: true,
        interactionMode: "normal",
        plainTarget: "input",
      }),
    ).toBe("list")
  })
})
