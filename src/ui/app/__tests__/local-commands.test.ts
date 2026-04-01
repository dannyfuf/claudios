import { describe, expect, it } from "bun:test"
import type { ParsedLocalSlashCommand } from "#commands/slash"
import { PERMISSION_MODES } from "#shared/permission-modes"
import { runLocalSlashCommand, type LocalCommandDependencies } from "#ui/app/local-commands"

describe("runLocalSlashCommand", () => {
  it("lists permission modes when /perm is submitted without arguments", async () => {
    const testHarness = createHarness()

    await runLocalSlashCommand(createCommand("perm"), testHarness.dependencies)

    expect(testHarness.systemMessages).toEqual([
      `Permission modes: ${PERMISSION_MODES.join(", ")}`,
    ])
  })

  it("rejects invalid permission modes without mutating state", async () => {
    const testHarness = createHarness()

    await runLocalSlashCommand(createCommand("perm", ["nope"]), testHarness.dependencies)

    expect(testHarness.permissionModes).toEqual([])
    expect(testHarness.errors).toEqual([
      `Invalid permission mode: nope. Expected one of ${PERMISSION_MODES.join(", ")}`,
    ])
  })

  it("reports plan mode on and off through the shared toggle path", async () => {
    const testHarness = createHarness()

    await runLocalSlashCommand(createCommand("plan"), testHarness.dependencies)
    await runLocalSlashCommand(createCommand("plan"), testHarness.dependencies)

    expect(testHarness.planToggleCalls).toBe(2)
    expect(testHarness.successes).toEqual(["Plan mode: on", "Plan mode: off"])
  })

  it("reports cancellation when plan exit is denied", async () => {
    const testHarness = createHarness({
      togglePlanModeResults: ["entered", "cancelled"],
    })

    await runLocalSlashCommand(createCommand("plan"), testHarness.dependencies)
    await runLocalSlashCommand(createCommand("plan"), testHarness.dependencies)

    expect(testHarness.successes).toEqual(["Plan mode: on"])
    expect(testHarness.infos).toEqual(["Plan mode: still on"])
  })
})

function createHarness(options?: {
  readonly togglePlanModeResults?: readonly ("entered" | "exited" | "cancelled")[]
}): {
  readonly dependencies: LocalCommandDependencies
  readonly systemMessages: string[]
  readonly errors: string[]
  readonly successes: string[]
  readonly infos: string[]
  readonly permissionModes: string[]
  readonly planToggleCalls: number
} {
  const systemMessages: string[] = []
  const errors: string[] = []
  const successes: string[] = []
  const infos: string[] = []
  const permissionModes: string[] = []
  const togglePlanModeResults = options?.togglePlanModeResults ?? ["entered", "exited"]
  let planToggleCallIndex = 0

  return {
    dependencies: {
      quit: async () => {
        return
      },
      newSession: async () => {
        return
      },
      openSessionPicker: async () => {
        return
      },
      clearMessages: () => {
        return
      },
      availableModelValues: [],
      setModel: async () => ({ ok: true }),
      setPermissionMode: async (mode) => {
        permissionModes.push(mode)
      },
      togglePlanMode: async () => {
        const result = togglePlanModeResults[planToggleCallIndex] ?? "cancelled"
        planToggleCallIndex += 1
        return result
      },
      appendSystemMessage: (text) => {
        systemMessages.push(text)
      },
      setTheme: () => {
        return
      },
      toggleDiffMode: () => "split",
      toggleThinkingVisibility: () => true,
      setShowThinking: () => {
        return
      },
      setVimEnabled: () => {
        return
      },
      vimEnabled: false,
      openKeymapHelp: () => {
        return
      },
      loadMcpServers: async () => [],
      openMcpOverlay: () => {
        return
      },
      notify: {
        success: (message) => {
          successes.push(message)
        },
        info: (message) => {
          infos.push(message)
        },
        error: (message) => {
          errors.push(message)
        },
      },
    },
    systemMessages,
    errors,
    successes,
    infos,
    permissionModes,
    get planToggleCalls() {
      return planToggleCallIndex
    },
  }
}

function createCommand(
  name: ParsedLocalSlashCommand["name"],
  args: readonly string[] = [],
): ParsedLocalSlashCommand {
  return { name, args }
}
