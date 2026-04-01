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
import { parseArgs, printHelp, printVersion } from "#cli/args"
import { runCliCommand } from "#cli/commands"
import { openExternalEditor } from "#cli/editor"
import { ConfigSchema, loadConfig } from "#config/schema"
import { Keymap } from "#commands/keymap"
import { checkAuth } from "#sdk/client"
import { getErrorMessage } from "#shared/errors"
import { ConversationService } from "#state/conversation-service"
import { App } from "#ui/App"
import {
  type AppController,
  AppControllerProvider,
  ConversationServiceProvider,
  ConfigProvider,
  KeymapProvider,
} from "#ui/hooks"

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

  if (await runCliCommand(cliArgs)) {
    return
  }

  const configResult = await loadConfig()
  if (!configResult.ok) {
    console.error(`Warning: ${configResult.error}`)
  }

  if (await runCliCommand(cliArgs, { configResult })) {
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
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null
  let root: ReturnType<typeof createRoot> | null = null

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
      useKittyKeyboard: { disambiguate: true, alternateKeys: true },
    })
    root = createRoot(renderer)
    root.render(renderApp())
  }

  const controller: AppController = {
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

  await mountRenderer()

  void (async () => {
    try {
      const authResult = await checkAuth(config)
      if (authResult.status === "failed") {
        service.markAuthFailed(authResult.message, authResult.failureKind)
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
