import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
])

export async function listWorkspaceFiles(
  rootDirectory: string,
  limit = 2000,
): Promise<readonly string[]> {
  const files: string[] = []

  async function visit(directory: string): Promise<void> {
    if (files.length >= limit) return

    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (files.length >= limit) return

      if (entry.name.startsWith(".") && entry.name !== ".claude") {
        continue
      }

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(join(directory, entry.name))
        }
        continue
      }

      if (!entry.isFile()) continue

      files.push(relative(rootDirectory, join(directory, entry.name)))
    }
  }

  await visit(rootDirectory)
  return files.sort((left, right) => left.localeCompare(right))
}
