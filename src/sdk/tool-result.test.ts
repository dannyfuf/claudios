import { describe, expect, it } from "bun:test"
import {
  buildUnifiedPatchFromStructuredPatch,
  extractToolResultIds,
  isFileModifyingToolName,
  normalizeFileToolResult,
} from "#sdk/tool-result"

describe("tool-result helpers", () => {
  it("detects supported file-modifying tool names", () => {
    expect(isFileModifyingToolName("Write")).toBe(true)
    expect(isFileModifyingToolName("Edit")).toBe(true)
    expect(isFileModifyingToolName("MultiEdit")).toBe(true)
    expect(isFileModifyingToolName("FileWriteTool")).toBe(true)
    expect(isFileModifyingToolName("Read")).toBe(false)
  })

  it("extracts tool result ids from mixed user message blocks", () => {
    expect(
      extractToolResultIds({
        content: [
          { type: "text", text: "Working..." },
          { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
          { type: "tool_result", tool_use_id: "tool-2", content: "ok" },
        ],
      }),
    ).toEqual(["tool-1", "tool-2"])
  })

  it("prefers git diff patches when the SDK provides them", () => {
    const patch = [
      "--- /tmp/example.ts",
      "+++ /tmp/example.ts",
      "@@ -1 +1 @@",
      "-const before = 1",
      "+const after = 2",
      "",
    ].join("\n")

    expect(
      normalizeFileToolResult("Write", {
        type: "update",
        filePath: "/tmp/example.ts",
        content: "const after = 2\n",
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ["-const before = 1", "+const after = 2"],
          },
        ],
        originalFile: "const before = 1\n",
        gitDiff: {
          filename: "tmp/example.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          changes: 2,
          patch,
        },
      }),
    ).toEqual({
      filePath: "/tmp/example.ts",
      changeType: "modified",
      patch,
    })
  })

  it("builds a unified diff when only structured patches are available", () => {
    expect(
      normalizeFileToolResult("Edit", {
        filePath: "/tmp/example.ts",
        oldString: "const before = 1",
        newString: "const after = 2",
        originalFile: "const before = 1\n",
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ["-const before = 1", "+const after = 2"],
          },
        ],
        userModified: false,
        replaceAll: false,
      }),
    ).toEqual({
      filePath: "/tmp/example.ts",
      changeType: "modified",
      patch: [
        "--- /tmp/example.ts",
        "+++ /tmp/example.ts",
        "@@ -1 +1 @@",
        "-const before = 1",
        "+const after = 2",
        "",
      ].join("\n"),
    })
  })

  it("builds added-file patches for new writes", () => {
    expect(
      normalizeFileToolResult("Write", {
        type: "create",
        filePath: "/tmp/new.ts",
        content: "export const created = true\n",
        originalFile: null,
        structuredPatch: [
          {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            lines: ["+export const created = true"],
          },
        ],
      }),
    ).toEqual({
      filePath: "/tmp/new.ts",
      changeType: "added",
      patch: [
        "--- /dev/null",
        "+++ /tmp/new.ts",
        "@@ -0,0 +1 @@",
        "+export const created = true",
        "",
      ].join("\n"),
    })
  })

  it("fails soft when structured patches are malformed", () => {
    expect(
      normalizeFileToolResult("Write", {
        type: "update",
        filePath: "/tmp/example.ts",
        originalFile: "before\n",
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ["const invalid = true"],
          },
        ],
      }),
    ).toBeNull()
  })

  it("rejects empty file paths when building fallback patches", () => {
    expect(
      buildUnifiedPatchFromStructuredPatch({
        filePath: "",
        changeType: "modified",
        structuredPatch: [],
      }),
    ).toBeNull()
  })
})
