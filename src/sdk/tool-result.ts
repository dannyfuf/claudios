import type { ToolCallFileChange, ToolCallFileChangeType, TodoItem, TodoStatus, TodoTrackerState } from "#sdk/types"

type StructuredPatchHunk = {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
}

const TODO_WRITE_TOOL_NAMES = new Set(["todowrite"])

const FILE_MODIFYING_TOOL_NAMES = new Set([
  "write",
  "edit",
  "multiedit",
  "filewritetool",
  "fileedittool",
  "multiedittool",
])

export function isFileModifyingToolName(toolName: string): boolean {
  return FILE_MODIFYING_TOOL_NAMES.has(toolName.trim().toLowerCase())
}

export function isTodoWriteToolName(toolName: string): boolean {
  return TODO_WRITE_TOOL_NAMES.has(toolName.trim().toLowerCase())
}

export function normalizeTodoToolResult(
  toolName: string,
  toolUseId: string,
  toolUseResult: unknown,
): TodoTrackerState | null {
  if (!isTodoWriteToolName(toolName) || !isRecord(toolUseResult)) {
    return null
  }

  const newTodos = parseTodoItems(toolUseResult["newTodos"])
  if (!newTodos) {
    return null
  }

  return {
    items: newTodos,
    lastUpdatedAt: new Date(),
    lastSourceToolUseId: toolUseId,
  }
}

function parseTodoItems(value: unknown): readonly TodoItem[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const items: TodoItem[] = []

  for (const item of value) {
    if (!isRecord(item)) {
      return null
    }

    const content = normalizeNonEmptyString(item["content"])
    const status = normalizeTodoStatus(item["status"])

    if (!content || !status) {
      return null
    }

    const activeForm = normalizeNonEmptyString(item["activeForm"])
    if (activeForm) {
      items.push({ content, status, activeForm })
    } else {
      items.push({ content, status })
    }
  }

  return items
}

function normalizeTodoStatus(value: unknown): TodoStatus | null {
  if (value === "pending" || value === "in_progress" || value === "completed") {
    return value
  }
  return null
}

export function extractToolResultIds(message: unknown): readonly string[] {
  if (!isRecord(message)) {
    return []
  }

  const content = message["content"]
  if (!Array.isArray(content)) {
    return []
  }

  const toolUseIds: string[] = []
  const seen = new Set<string>()

  for (const block of content) {
    if (!isRecord(block) || block["type"] !== "tool_result") {
      continue
    }

    const toolUseId = block["tool_use_id"]
    if (typeof toolUseId !== "string" || seen.has(toolUseId)) {
      continue
    }

    seen.add(toolUseId)
    toolUseIds.push(toolUseId)
  }

  return toolUseIds
}

export function normalizeFileToolResult(
  toolName: string,
  toolUseResult: unknown,
): ToolCallFileChange | null {
  if (!isFileModifyingToolName(toolName) || !isRecord(toolUseResult)) {
    return null
  }

  const gitDiff = parseGitDiff(toolUseResult["gitDiff"])
  const filePath =
    normalizeNonEmptyString(toolUseResult["filePath"]) ?? normalizeNonEmptyString(gitDiff?.filename)

  if (!filePath) {
    return null
  }

  const changeType = resolveFileChangeType(toolUseResult, gitDiff?.status ?? null)
  if (!changeType) {
    return null
  }

  if (gitDiff && gitDiff.patch.length > 0) {
    return {
      filePath,
      patch: gitDiff.patch,
      changeType,
    }
  }

  const structuredPatch = parseStructuredPatch(toolUseResult["structuredPatch"])
  if (!structuredPatch) {
    return null
  }

  const patch = buildUnifiedPatchFromStructuredPatch({
    filePath,
    changeType,
    structuredPatch,
  })

  if (!patch) {
    return null
  }

  return {
    filePath,
    patch,
    changeType,
  }
}

export function buildUnifiedPatchFromStructuredPatch(input: {
  readonly filePath: string
  readonly changeType: ToolCallFileChangeType
  readonly structuredPatch: readonly StructuredPatchHunk[]
}): string | null {
  if (input.filePath.trim().length === 0) {
    return null
  }

  const patchLines = [
    `--- ${input.changeType === "added" ? "/dev/null" : input.filePath}`,
    `+++ ${input.filePath}`,
  ]

  for (const hunk of input.structuredPatch) {
    if (!isStructuredPatchHunk(hunk)) {
      return null
    }

    patchLines.push(
      `@@ -${formatHunkRange(hunk.oldStart, hunk.oldLines)} +${formatHunkRange(hunk.newStart, hunk.newLines)} @@`,
    )

    for (const line of hunk.lines) {
      if (!isPatchLine(line)) {
        return null
      }

      patchLines.push(line)
    }
  }

  return `${patchLines.join("\n")}\n`
}

function resolveFileChangeType(
  toolUseResult: Record<string, unknown>,
  gitDiffStatus: ToolCallFileChangeType | null,
): ToolCallFileChangeType | null {
  if (gitDiffStatus) {
    return gitDiffStatus
  }

  const writeType = toolUseResult["type"]
  if (writeType === "create") {
    return "added"
  }

  if (writeType === "update") {
    return "modified"
  }

  if (toolUseResult["originalFile"] === null) {
    return "added"
  }

  if (typeof toolUseResult["originalFile"] === "string") {
    return "modified"
  }

  return null
}

function parseGitDiff(value: unknown): {
  readonly filename: string | null
  readonly patch: string
  readonly status: ToolCallFileChangeType | null
} | null {
  if (!isRecord(value)) {
    return null
  }

  const patch = normalizeNonEmptyString(value["patch"])
  if (!patch) {
    return null
  }

  return {
    filename: normalizeNonEmptyString(value["filename"]),
    patch,
    status: normalizeChangeType(value["status"]),
  }
}

function parseStructuredPatch(value: unknown): readonly StructuredPatchHunk[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const hunks: StructuredPatchHunk[] = []

  for (const hunk of value) {
    if (!isStructuredPatchHunk(hunk)) {
      return null
    }

    hunks.push(hunk)
  }

  return hunks
}

function isStructuredPatchHunk(value: unknown): value is StructuredPatchHunk {
  if (!isRecord(value)) {
    return false
  }

  const lines = value["lines"]

  return (
    typeof value["oldStart"] === "number" &&
    typeof value["oldLines"] === "number" &&
    typeof value["newStart"] === "number" &&
    typeof value["newLines"] === "number" &&
    Array.isArray(lines) &&
    lines.every((line) => typeof line === "string")
  )
}

function isPatchLine(line: string): boolean {
  if (line.length === 0) {
    return false
  }

  const prefix = line[0]
  return prefix === "+" || prefix === "-" || prefix === " " || prefix === "\\"
}

function normalizeChangeType(value: unknown): ToolCallFileChangeType | null {
  return value === "added" || value === "modified" ? value : null
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function formatHunkRange(start: number, lineCount: number): string {
  if (lineCount === 1) {
    return String(start)
  }

  return `${start},${lineCount}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
