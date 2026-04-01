import { existsSync } from "node:fs"
import { realpath } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getErrorMessage } from "#shared/errors"

export async function runUpgrade(): Promise<void> {
  if (!Bun.which("git")) {
    console.error("Error: git is required to upgrade claudios.")
    process.exitCode = 1
    return
  }

  if (!Bun.which("bun")) {
    console.error("Error: bun is required to rebuild claudios after upgrade.")
    process.exitCode = 1
    return
  }

  const repoRoot = await findRunningRepoRoot()
  if (!repoRoot) {
    console.error("Error: could not locate the claudios repository for the running binary.")
    console.error("Run the installer again to refresh the local checkout.")
    process.exitCode = 1
    return
  }

  const runStep = (command: string[], label: string) => {
    console.log(label)
    const result = Bun.spawnSync([...command], {
      cwd: repoRoot,
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })

    if (result.exitCode !== 0) {
      throw new Error(`${command.join(" ")} failed with exit code ${result.exitCode}`)
    }
  }

  console.log(`Upgrading claudios from ${repoRoot}`)
  console.log("")

  try {
    runStep(["git", "pull", "--ff-only"], "Fetching latest changes...")

    const frozenInstall = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
      cwd: repoRoot,
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })

    if (frozenInstall.exitCode !== 0) {
      console.log("Falling back to bun install...")
      runStep(["bun", "install"], "Installing dependencies...")
    }

    runStep(["bun", "run", "build"], "Building claudios...")
    console.log("\nclaudios upgraded successfully.")
  } catch (error) {
    console.error(`\nUpgrade failed: ${getErrorMessage(error)}`)
    process.exitCode = 1
  }
}

async function findRunningRepoRoot(): Promise<string | null> {
  const entryPath = process.argv[1]
    ? await realpath(process.argv[1]).catch(() => process.argv[1] ?? fileURLToPath(import.meta.url))
    : fileURLToPath(import.meta.url)

  let current = dirname(entryPath)
  while (true) {
    if (
      existsSync(join(current, ".git"))
      && existsSync(join(current, "package.json"))
      && existsSync(join(current, "install.sh"))
    ) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      return null
    }

    current = parent
  }
}
