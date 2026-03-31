/**
 * Entry point for claudios TUI.
 *
 * 1. Parse CLI args
 * 2. Load config
 * 3. Create renderer
 * 4. Initialize services
 * 5. Render React app
 */

import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_PATH, ConfigSchema, loadConfig } from "#config/schema"
import { ConversationService } from "#state/conversation-service"
import { Keymap } from "#commands/keymap"
import { checkAuth, getSessionInfo, getSessionMessages, listSessions } from "#sdk/client"
import { sessionSummaryFromSDK } from "#sdk/types"
import { App } from "#ui/App"
import {
  type AppController,
  AppControllerProvider,
  ConversationServiceProvider,
  ConfigProvider,
  KeymapProvider,
} from "#ui/hooks"

// ---------------------------------------------------------------------------
// CLI argument parsing (lightweight, no external dep)
// ---------------------------------------------------------------------------

type CLIArgs =
  | {
      command: "chat"
      resume: string | null
      model: string | null
      permissionMode: string | null
      cwd: string | null
    }
  | { command: "help" }
  | { command: "version" }
  | { command: "uninstall" }
  | { command: "sessions.list" }
  | { command: "sessions.show"; sessionId: string | null }
  | { command: "config" }

function parseArgs(argv: string[]): CLIArgs {
  const args = argv.slice(2) // skip bun and script path
  const result: Extract<CLIArgs, { command: "chat" }> = {
    command: "chat",
    resume: null,
    model: null,
    permissionMode: null,
    cwd: null,
  }

  if (args[0] === "sessions" && args[1] === "list") {
    return { command: "sessions.list" }
  }

  if (args[0] === "sessions" && args[1] === "show") {
    return { command: "sessions.show", sessionId: args[2] ?? null }
  }

  if (args[0] === "config") {
    return { command: "config" }
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    switch (arg) {
      case "chat":
        result.command = "chat"
        break
      case "--help":
      case "-h":
      case "help":
        return { command: "help" }
      case "--version":
      case "-v":
      case "version":
        return { command: "version" }
      case "--uninstall":
      case "uninstall":
        return { command: "uninstall" }
      case "--resume":
        result.resume = args[++i] ?? null
        break
      case "--model":
        result.model = args[++i] ?? null
        break
      case "--permission-mode":
        result.permissionMode = args[++i] ?? null
        break
      case "--cwd":
        result.cwd = args[++i] ?? null
        break
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Help + version
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
claudios - A power-user TUI for Claude Code

Usage:
  claudios [chat] [flags]

Commands:
  chat                   Launch the TUI chat (default)
  sessions list          List saved sessions
  sessions show <id>     Show a session transcript
  config                 Show resolved config
  uninstall              Remove claudios from your system
  help                   Show this help

Flags:
  --resume <sessionId>   Resume a session
  --model <model>        Override default model
  --permission-mode <m>  Set permission mode
  --cwd <path>           Set working directory
  --uninstall            Remove claudios from your system
  -h, --help             Show help
  -v, --version          Show version
`)
}

function printVersion(): void {
  console.log("claudios v0.1.0")
}

async function runUninstall(): Promise<void> {
  const { existsSync } = await import("node:fs")
  const { rm } = await import("node:fs/promises")
  const { homedir } = await import("node:os")
  const { join } = await import("node:path")

  const home = homedir()
  const targets = [
    { path: join(home, ".local", "bin", "claudios"), label: "CLI symlink (~/.local/bin/claudios)" },
    { path: join(home, ".local", "share", "claudios"), label: "App files (~/.local/share/claudios)" },
    { path: join(home, ".config", "claudios"), label: "Config (~/.config/claudios)" },
  ]

  console.log("The following will be removed:")
  for (const t of targets) {
    const exists = existsSync(t.path)
    console.log(`  ${exists ? "✓" : "–"} ${t.label}`)
  }
  console.log()

  // Prompt for confirmation
  process.stdout.write("Proceed with uninstall? [y/N] ")
  const answer = await new Promise<string>((resolve) => {
    let buf = ""
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk: string) => {
      buf += chunk
      if (chunk === "\r" || chunk === "\n" || chunk.length > 0) {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        resolve(buf.trim())
      }
    })
  })
  console.log(answer)

  if (answer.toLowerCase() !== "y") {
    console.log("Uninstall cancelled.")
    return
  }

  let hadError = false
  for (const t of targets) {
    if (existsSync(t.path)) {
      try {
        await rm(t.path, { recursive: true, force: true })
        console.log(`  removed  ${t.label}`)
      } catch (err) {
        console.error(`  failed   ${t.label}: ${(err as Error).message}`)
        hadError = true
      }
    }
  }

  if (!hadError) {
    console.log("\nclaudios uninstalled successfully.")
  } else {
    console.error("\nUninstall completed with errors.")
    process.exitCode = 1
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cliArgs = parseArgs(process.argv)

  if (cliArgs.command === "help") {
    printHelp()
    return
  }

  if (cliArgs.command === "version") {
    printVersion()
    return
  }

  if (cliArgs.command === "uninstall") {
    await runUninstall()
    return
  }

  // Load config
  const configResult = await loadConfig()
  if (!configResult.ok) {
    console.error(`Warning: ${configResult.error}`)
  }

  if (cliArgs.command === "config") {
    console.log(`Config path: ${CONFIG_PATH}`)
    console.log(JSON.stringify(configResult.config, null, 2))
    return
  }

  if (cliArgs.command === "sessions.list") {
    const sessions = await listSessions()
    for (const session of sessions.map(sessionSummaryFromSDK)) {
      console.log(
        `${session.id}  ${session.title}  ${session.lastModified.toLocaleString()}`,
      )
    }
    return
  }

  if (cliArgs.command === "sessions.show") {
    if (!cliArgs.sessionId) {
      console.error("Error: session id required")
      process.exitCode = 1
      return
    }

    const info = await getSessionInfo(cliArgs.sessionId)
    if (!info) {
      console.error(`Error: session not found: ${cliArgs.sessionId}`)
      process.exitCode = 1
      return
    }

    const messages = await getSessionMessages(cliArgs.sessionId)
    console.log(`Session: ${info.sessionId}`)
    console.log(`Title: ${info.customTitle ?? info.summary ?? "(untitled)"}`)
    console.log(`Last modified: ${new Date(info.lastModified).toLocaleString()}`)
    console.log("")

    for (const message of messages) {
      const raw = message as Record<string, unknown>
      const type = raw["type"] === "assistant" ? "Claude" : "You"
      const text = extractSessionText(raw["message"])
      console.log(`${type}: ${text}`)
      console.log("")
    }
    return
  }

  if (cliArgs.command !== "chat") {
    return
  }

  const config = ConfigSchema.parse({
    ...configResult.config,
    ...(cliArgs.model ? { defaultModel: cliArgs.model } : {}),
    ...(cliArgs.permissionMode
      ? { defaultPermissionMode: cliArgs.permissionMode }
      : {}),
  })

  // Change working directory if specified
  if (cliArgs.cwd) {
    process.chdir(cliArgs.cwd)
  }

  // Create keymap
  const keymap = new Keymap(config.keybindings)

  // Create conversation service
  const service = new ConversationService(config)
  service.beginStartup({ resumeSessionId: cliArgs.resume })
  let controller: AppController
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null
  let root: ReturnType<typeof createRoot> | null = null

  const renderApp = () => (
    <ConfigProvider value={config}>
      <KeymapProvider value={keymap}>
        <ConversationServiceProvider value={service}>
          <AppControllerProvider value={controller}>
            <App />
          </AppControllerProvider>
        </ConversationServiceProvider>
      </KeymapProvider>
    </ConfigProvider>
  )

  const unmountRenderer = async () => {
    root?.unmount()
    root = null
    renderer?.destroy()
    renderer = null
  }

  const mountRenderer = async () => {
    renderer = await createCliRenderer({
      exitOnCtrlC: false,
      useMouse: true,
    })
    root = createRoot(renderer)
    root.render(renderApp())
  }

  controller = {
    quit: async () => {
      await service.cleanup()
      await unmountRenderer()
    },
    openEditor: async (initialText: string) => {
      await unmountRenderer()
      try {
        return await openExternalEditor(config.editor, initialText)
      } finally {
        await mountRenderer()
      }
    },
  }

  await mountRenderer()

  void (async () => {
    const authRequiredMessage =
      "Claude Code authentication required. Run `claude auth login` to authenticate, then try again."

    try {
      const isAuthenticated = await checkAuth(config)
      if (!isAuthenticated) {
        service.markAuthFailed(authRequiredMessage)
        return
      }

      service.markAuthReady()

      if (cliArgs.resume) {
        await service.startResumeSession(cliArgs.resume).catch(() => {
          return
        })
      }
    } catch (error) {
      service.markAuthFailed(`Failed to initialize Claude Code: ${getErrorMessage(error)}`)
    }
  })()
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exitCode = 1
})

async function openExternalEditor(
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

function resolveEditorCommand(editorSetting: string): string {
  const visual = process.env.VISUAL
  const editor = process.env.EDITOR
  const resolvedDefault = visual || editor || "vi"

  return editorSetting
    .replaceAll("$VISUAL", visual || resolvedDefault)
    .replaceAll("$EDITOR", editor || resolvedDefault)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function extractSessionText(message: unknown): string {
  if (!message || typeof message !== "object") return ""
  const raw = message as Record<string, unknown>
  const content = raw["content"]

  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block
        if (block && typeof block === "object") {
          const candidate = (block as Record<string, unknown>)["text"]
          if (typeof candidate === "string") {
            return candidate
          }
        }
        return ""
      })
      .join("")
  }

  return ""
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
