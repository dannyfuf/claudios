import { describe, expect, it } from "bun:test"
import { getSlashPickerQuery } from "#ui/slash-picker"

describe("getSlashPickerQuery", () => {
  const cases: ReadonlyArray<{
    readonly promptText: string
    readonly expected: string | null
  }> = [
    { promptText: "", expected: null },
    { promptText: "/", expected: "/" },
    { promptText: "/p", expected: "/p" },
    { promptText: "/perm ", expected: null },
    { promptText: "hello", expected: null },
    { promptText: "hello/", expected: null },
  ]

  for (const testCase of cases) {
    it(`returns ${String(testCase.expected)} for ${JSON.stringify(testCase.promptText)}`, () => {
      expect(getSlashPickerQuery(testCase.promptText)).toBe(testCase.expected)
    })
  }
})
