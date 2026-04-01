import { parseVimCommandMode, type ParsedLocalSlashCommand } from "#commands/slash"
import type { McpServerStatus } from "#sdk/types"
import { getErrorMessage } from "#shared/errors"
import { PERMISSION_MODES, type PermissionModeName, isPermissionModeName } from "#shared/permission-modes"
import { THEME_NAMES, type ThemeName, isThemeName } from "#ui/theme"

export type SetModelResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string }

export type LocalCommandNotifier = {
  readonly success: (message: string) => void
  readonly info: (message: string) => void
  readonly error: (message: string) => void
}

export type LocalCommandDependencies = {
  readonly quit: () => Promise<void>
  readonly newSession: () => Promise<void>
  readonly openSessionPicker: () => Promise<void>
  readonly clearMessages: () => void
  readonly availableModelValues: readonly string[]
  readonly setModel: (model: string) => Promise<SetModelResult>
  readonly setPermissionMode: (mode: PermissionModeName) => Promise<void>
  readonly togglePlanMode: () => Promise<"entered" | "exited" | "cancelled">
  readonly appendSystemMessage: (text: string) => void
  readonly setTheme: (themeName: ThemeName) => void
  readonly toggleDiffMode: () => "unified" | "split"
  readonly toggleThinkingVisibility: () => boolean
  readonly setShowThinking: (showThinking: boolean) => void
  readonly setVimEnabled: (enabled: boolean) => void
  readonly vimEnabled: boolean
  readonly openKeymapHelp: () => void
  readonly loadMcpServers: () => Promise<readonly McpServerStatus[]>
  readonly openMcpOverlay: (servers: readonly McpServerStatus[]) => void
  readonly notify: LocalCommandNotifier
}

export async function runLocalSlashCommand(
  command: ParsedLocalSlashCommand,
  dependencies: LocalCommandDependencies,
): Promise<void> {
  switch (command.name) {
    case "q":
      await dependencies.quit()
      return
    case "new":
      await dependencies.newSession()
      return
    case "sessions":
      await dependencies.openSessionPicker()
      return
    case "clear":
      dependencies.clearMessages()
      return
    case "model": {
      const nextModel = command.args.join(" ").trim()
      if (!nextModel) {
        const choices = dependencies.availableModelValues.join(", ")
        dependencies.appendSystemMessage(
          choices ? `Available models: ${choices}` : "No models reported by the SDK yet.",
        )
        return
      }

      const result = await dependencies.setModel(nextModel)
      if (!result.ok) {
        dependencies.notify.error(`Failed to set model: ${result.error}`)
      }
      return
    }
    case "plan": {
      try {
        const result = await dependencies.togglePlanMode()
        if (result === "entered") {
          dependencies.notify.success("Plan mode: on")
        } else if (result === "exited") {
          dependencies.notify.success("Plan mode: off")
        } else {
          dependencies.notify.info("Plan mode: still on")
        }
      } catch (error) {
        dependencies.notify.error(`Failed to set permission mode: ${getErrorMessage(error)}`)
      }
      return
    }
    case "perm": {
      const nextMode = command.args.join(" ").trim()
      if (!nextMode) {
        dependencies.appendSystemMessage(`Permission modes: ${PERMISSION_MODES.join(", ")}`)
        return
      }

      if (!isPermissionModeName(nextMode)) {
        dependencies.notify.error(
          `Invalid permission mode: ${nextMode}. Expected one of ${PERMISSION_MODES.join(", ")}`,
        )
        return
      }

      await dependencies.setPermissionMode(nextMode)
      dependencies.notify.success(`Permission mode: ${nextMode}`)
      return
    }
    case "theme": {
      const nextTheme = command.args.join(" ").trim()
      if (!nextTheme) {
        dependencies.appendSystemMessage(`Themes: ${THEME_NAMES.join(", ")}`)
        return
      }

      if (!isThemeName(nextTheme)) {
        dependencies.notify.error(
          `Invalid theme: ${nextTheme}. Expected one of ${THEME_NAMES.join(", ")}`,
        )
        return
      }

      dependencies.setTheme(nextTheme)
      dependencies.notify.success(`Theme: ${nextTheme}`)
      return
    }
    case "diff": {
      const nextMode = dependencies.toggleDiffMode()
      dependencies.notify.info(`Diff mode: ${nextMode}`)
      return
    }
    case "thinking": {
      const mode = command.args.join(" ").trim().toLowerCase()
      if (!mode || mode === "toggle") {
        const showThinking = dependencies.toggleThinkingVisibility()
        dependencies.notify.info(`Thinking: ${showThinking ? "on" : "off"}`)
        return
      }

      if (mode !== "on" && mode !== "off") {
        dependencies.notify.error("Invalid thinking mode: expected on, off, or toggle")
        return
      }

      const showThinking = mode === "on"
      dependencies.setShowThinking(showThinking)
      dependencies.notify.info(`Thinking: ${showThinking ? "on" : "off"}`)
      return
    }
    case "vim": {
      const result = parseVimCommandMode(command.args)
      if (!result.ok) {
        dependencies.notify.error(result.error)
        return
      }

      const nextEnabled = result.mode === "toggle" ? !dependencies.vimEnabled : result.mode === "on"
      if (nextEnabled === dependencies.vimEnabled) {
        dependencies.notify.info(`Vim: already ${nextEnabled ? "on" : "off"}`)
        return
      }

      dependencies.setVimEnabled(nextEnabled)
      dependencies.notify.info(`Vim: ${nextEnabled ? "on" : "off"}`)
      return
    }
    case "keys":
      dependencies.openKeymapHelp()
      return
    case "mcp": {
      try {
        const servers = await dependencies.loadMcpServers()
        dependencies.openMcpOverlay(servers)
      } catch (error) {
        dependencies.notify.error(getErrorMessage(error))
      }
      return
    }
  }
}
