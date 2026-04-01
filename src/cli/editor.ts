import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export async function openExternalEditor(
  editorSetting: string,
  initialText: string,
): Promise<string | null> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "claudios-"))
  const filePath = join(tempDirectory, "prompt.md")

  try {
    await writeFile(filePath, initialText, "utf8")

    const editorCommand = resolveEditorCommand(editorSetting)
    const command = `${editorCommand} ${shellQuote(filePath)}`
    const result = Bun.spawnSync(["zsh", "-lc", command], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: process.env,
    })

    if (result.exitCode !== 0) {
      return null
    }

    return await readFile(filePath, "utf8")
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

export function resolveEditorCommand(
  editorSetting: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const visual = environment.VISUAL
  const editor = environment.EDITOR
  const resolvedDefault = visual || editor || "vi"

  return editorSetting
    .replaceAll("$VISUAL", visual || resolvedDefault)
    .replaceAll("$EDITOR", editor || resolvedDefault)
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
