import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { getErrorMessage } from "#shared/errors"

export async function runUninstall(): Promise<void> {
  const home = homedir()
  const targets = [
    { path: join(home, ".local", "bin", "claudios"), label: "CLI symlink (~/.local/bin/claudios)" },
    { path: join(home, ".local", "share", "claudios"), label: "App files (~/.local/share/claudios)" },
    { path: join(home, ".config", "claudios"), label: "Config (~/.config/claudios)" },
  ] as const

  console.log("The following will be removed:")
  for (const target of targets) {
    const exists = existsSync(target.path)
    console.log(`  ${exists ? "✓" : "–"} ${target.label}`)
  }
  console.log("")

  process.stdout.write("Proceed with uninstall? [y/N] ")
  const answer = await promptForConfirmation()
  console.log(answer)

  if (answer.toLowerCase() !== "y") {
    console.log("Uninstall cancelled.")
    return
  }

  let hadError = false
  for (const target of targets) {
    if (!existsSync(target.path)) {
      continue
    }

    try {
      await rm(target.path, { recursive: true, force: true })
      console.log(`  removed  ${target.label}`)
    } catch (error) {
      console.error(`  failed   ${target.label}: ${getErrorMessage(error)}`)
      hadError = true
    }
  }

  if (!hadError) {
    console.log("\nclaudios uninstalled successfully.")
    return
  }

  console.error("\nUninstall completed with errors.")
  process.exitCode = 1
}

async function promptForConfirmation(): Promise<string> {
  return await new Promise((resolve) => {
    let buffer = ""

    const cleanup = () => {
      process.stdin.off("data", onData)
      if (typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(false)
      }
      process.stdin.pause()
    }

    const onData = (chunk: string) => {
      buffer += chunk
      if (chunk === "\r" || chunk === "\n" || chunk.length > 0) {
        cleanup()
        resolve(buffer.trim())
      }
    }

    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", onData)
  })
}
