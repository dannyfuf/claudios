import { describe, expect, it } from "bun:test"
import {
  buildUnifiedPatchFromStructuredPatch,
  extractToolResultIds,
  isFileModifyingToolName,
  isTodoWriteToolName,
  normalizeFileToolResult,
  normalizeTodoToolResult,
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

describe("todo tool helpers", () => {
  it("detects TodoWrite tool name case-insensitively", () => {
    expect(isTodoWriteToolName("TodoWrite")).toBe(true)
    expect(isTodoWriteToolName("todowrite")).toBe(true)
    expect(isTodoWriteToolName("TODOWRITE")).toBe(true)
    expect(isTodoWriteToolName("Write")).toBe(false)
    expect(isTodoWriteToolName("Read")).toBe(false)
  })

  it("parses a valid TodoWrite result with newTodos", () => {
    const result = normalizeTodoToolResult("TodoWrite", "tool-1", {
      newTodos: [
        { content: "Set up project", status: "completed" },
        { content: "Implement feature", status: "in_progress", activeForm: "implementing feature" },
        { content: "Write tests", status: "pending" },
      ],
      oldTodos: [],
    })

    expect(result).not.toBeNull()
    expect(result?.items).toHaveLength(3)
    expect(result?.items[0]).toEqual({ content: "Set up project", status: "completed" })
    expect(result?.items[1]).toEqual({
      content: "Implement feature",
      status: "in_progress",
      activeForm: "implementing feature",
    })
    expect(result?.items[2]).toEqual({ content: "Write tests", status: "pending" })
    expect(result?.lastSourceToolUseId).toBe("tool-1")
  })

  it("omits activeForm when absent or empty", () => {
    const result = normalizeTodoToolResult("TodoWrite", "tool-1", {
      newTodos: [{ content: "Task one", status: "pending", activeForm: "" }],
    })

    expect(result?.items[0]).toEqual({ content: "Task one", status: "pending" })
    expect(result?.items[0]).not.toHaveProperty("activeForm")
  })

  it("returns null for non-TodoWrite tool names", () => {
    expect(normalizeTodoToolResult("Write", "tool-1", { newTodos: [] })).toBeNull()
    expect(normalizeTodoToolResult("Read", "tool-1", { newTodos: [] })).toBeNull()
  })

  it("returns null when newTodos is missing", () => {
    expect(normalizeTodoToolResult("TodoWrite", "tool-1", { oldTodos: [] })).toBeNull()
  })

  it("returns null when newTodos contains a malformed item", () => {
    expect(
      normalizeTodoToolResult("TodoWrite", "tool-1", {
        newTodos: [{ content: 42, status: "pending" }],
      }),
    ).toBeNull()
  })

  it("returns null when newTodos contains an item with an invalid status", () => {
    expect(
      normalizeTodoToolResult("TodoWrite", "tool-1", {
        newTodos: [{ content: "Task", status: "unknown" }],
      }),
    ).toBeNull()
  })

  it("fails soft when the tool result is not an object", () => {
    expect(normalizeTodoToolResult("TodoWrite", "tool-1", "invalid")).toBeNull()
    expect(normalizeTodoToolResult("TodoWrite", "tool-1", null)).toBeNull()
    expect(normalizeTodoToolResult("TodoWrite", "tool-1", [])).toBeNull()
  })
})
