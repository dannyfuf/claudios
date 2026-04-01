import type { ToolCallFileChangeType } from "#sdk/types"

export type StructuredPatchHunk = {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
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

export function isStructuredPatchHunk(value: unknown): value is StructuredPatchHunk {
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

function formatHunkRange(start: number, lineCount: number): string {
  if (lineCount === 1) {
    return String(start)
  }

  return `${start},${lineCount}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
