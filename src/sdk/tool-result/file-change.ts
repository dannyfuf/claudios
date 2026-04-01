import type { ToolCallFileChange, ToolCallFileChangeType } from "#sdk/types"
import {
  buildUnifiedPatchFromStructuredPatch,
  isStructuredPatchHunk,
  type StructuredPatchHunk,
} from "./patch"

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

function normalizeChangeType(value: unknown): ToolCallFileChangeType | null {
  return value === "added" || value === "modified" ? value : null
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
