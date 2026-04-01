import { afterEach, describe, expect, it } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import type { AccountInfo, ModelInfo, SlashCommand } from "#sdk/types"
import { DEFAULT_CONFIG } from "#config/schema"
import { Keymap } from "#commands/keymap"
import { ConversationService } from "#state/conversation-service"
import {
  initialConversationState,
  type ConversationState,
  type SessionState,
  type VimMode,
} from "#state/types"
import {
  AppControllerProvider,
  ConfigProvider,
  ConversationServiceProvider,
  KeymapProvider,
  type AppController,
} from "#ui/hooks"
import { App } from "#ui/App"

const TEST_ACCOUNT: AccountInfo = {
  email: "test@example.com",
  apiProvider: "firstParty",
}

const TEST_MODELS: readonly ModelInfo[] = [
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "Balanced test model",
  },
] as const

const TEST_SDK_COMMANDS: readonly SlashCommand[] = [
  {
    name: "plan",
    description: "Create a step-by-step plan",
    argumentHint: "<task>",
  },
] as const

const TEST_APP_CONTROLLER: AppController = {
  quit: async () => {
    return
  },
  openEditor: async () => null,
}

let renderedApp: Awaited<ReturnType<typeof renderTestApp>> | null = null

afterEach(() => {
  if (renderedApp) {
    act(() => {
      renderedApp?.testSetup.renderer.destroy()
    })
    renderedApp = null
  }
})

describe("App plan mode", () => {
  it("toggles plan mode with tab in plain mode", async () => {
    renderedApp = await renderTestApp()

    const frame = await pressKeyAndRender(renderedApp.testSetup, "tab")

    expect(renderedApp.service.getState().planMode.active).toBe(true)
    expect(renderedApp.service.getState().permissionMode).toBe("plan")
    expect(frame).toContain("plan mode")
  })

  it("toggles plan mode with tab in vim normal mode without leaving normal mode", async () => {
    renderedApp = await renderTestApp({ vimEnabled: true, vimMode: "normal" })

    await pressKeyAndRender(renderedApp.testSetup, "tab")

    expect(renderedApp.service.getState().planMode.active).toBe(true)
    expect(renderedApp.service.getState().vimMode).toBe("normal")
  })

  it("does not toggle plan mode when a slash picker is open", async () => {
    renderedApp = await renderTestApp()

    let frame = await typeAndRender(renderedApp.testSetup, "/")
    expect(frame).toContain("slash commands")

    frame = await pressKeyAndRender(renderedApp.testSetup, "tab")

    expect(renderedApp.service.getState().planMode.active).toBe(false)
    expect(frame).toContain("slash commands")
  })

  it("shows an approval dialog when the assistant requests plan mode exit", async () => {
    renderedApp = await renderTestApp()
    await enterPlanMode(renderedApp)

    const exitPromise = renderedApp.service.requestPlanModeExit("assistant")
    let frame = await renderFrame(renderedApp.testSetup)

    expect(renderedApp.service.getState().sessionState.status).toBe("awaiting_permission")
    expect(frame).toContain("Claude wants to exit plan mode.")

    frame = await pressEnterAndRender(renderedApp.testSetup)

    await expect(exitPromise).resolves.toBe(true)
    expect(renderedApp.service.getState().planMode.active).toBe(false)
    expect(renderedApp.service.getState().permissionMode).toBe(DEFAULT_CONFIG.defaultPermissionMode)
    expect(frame).not.toContain("Claude wants to exit plan mode.")
  })

  it("requests approval before exiting plan mode with tab", async () => {
    renderedApp = await renderTestApp()
    await enterPlanMode(renderedApp)

    let frame = await pressKeyAndRender(renderedApp.testSetup, "tab")

    expect(renderedApp.service.getState().sessionState.status).toBe("awaiting_permission")
    expect(renderedApp.service.getState().planMode.active).toBe(true)
    expect(frame).toContain("restore write access")

    frame = await pressEnterAndRender(renderedApp.testSetup)

    expect(renderedApp.service.getState().planMode.active).toBe(false)
    expect(renderedApp.service.getState().permissionMode).toBe(DEFAULT_CONFIG.defaultPermissionMode)
    expect(frame).not.toContain("restore write access")
  })

  it("requests approval before exiting plan mode with /plan", async () => {
    renderedApp = await renderTestApp()
    await enterPlanMode(renderedApp)

    await typeAndRender(renderedApp.testSetup, "/plan")
    let frame = await pressEnterAndRender(renderedApp.testSetup)

    expect(renderedApp.service.getState().sessionState.status).toBe("awaiting_permission")
    expect(renderedApp.service.getState().planMode.active).toBe(true)
    expect(frame).toContain("restore write access")

    frame = await pressEnterAndRender(renderedApp.testSetup)

    expect(renderedApp.service.getState().planMode.active).toBe(false)
    expect(renderedApp.service.getState().permissionMode).toBe(DEFAULT_CONFIG.defaultPermissionMode)
    expect(renderedApp.service.getState().promptText).toBe("")
    expect(frame).not.toContain("restore write access")
  })
})

function createReadyConversationState(options?: {
  readonly promptText?: string
  readonly vimEnabled?: boolean
  readonly vimMode?: VimMode
  readonly sessionState?: SessionState
}): ConversationState {
  return {
    ...initialConversationState,
    startup: {
      auth: { status: "ready" },
      resume: { status: "ready" },
      metadata: { status: "ready" },
    },
    promptText: options?.promptText ?? "",
    model: DEFAULT_CONFIG.defaultModel,
    permissionMode: DEFAULT_CONFIG.defaultPermissionMode,
    themeName: DEFAULT_CONFIG.theme,
    diffMode: DEFAULT_CONFIG.diffMode,
    showThinking: DEFAULT_CONFIG.showThinking,
    vimEnabled: options?.vimEnabled ?? false,
    vimMode: options?.vimMode ?? "insert",
    sessionState: options?.sessionState ?? initialConversationState.sessionState,
    availableModels: TEST_MODELS,
    availableCommands: TEST_SDK_COMMANDS,
    account: TEST_ACCOUNT,
  }
}

async function renderTestApp(options?: {
  readonly promptText?: string
  readonly vimEnabled?: boolean
  readonly vimMode?: VimMode
  readonly sessionState?: SessionState
}) {
  const service = new ConversationService(DEFAULT_CONFIG, createReadyConversationState(options))
  const keymap = new Keymap(DEFAULT_CONFIG.keybindings)
  const testSetup = await testRender(
    <ConfigProvider value={DEFAULT_CONFIG}>
      <KeymapProvider value={keymap}>
        <ConversationServiceProvider value={service}>
          <AppControllerProvider value={TEST_APP_CONTROLLER}>
            <App />
          </AppControllerProvider>
        </ConversationServiceProvider>
      </KeymapProvider>
    </ConfigProvider>,
    {
      width: 100,
      height: 30,
    },
  )

  await renderFrame(testSetup)

  return { testSetup, service }
}

async function typeAndRender(
  testSetup: Awaited<ReturnType<typeof testRender>>,
  text: string,
): Promise<string> {
  await act(async () => {
    await testSetup.mockInput.typeText(text)
    await Bun.sleep(0)
  })

  return renderFrame(testSetup)
}

async function pressKeyAndRender(
  testSetup: Awaited<ReturnType<typeof testRender>>,
  key: string,
): Promise<string> {
  await act(async () => {
    if (key === "tab") {
      testSetup.mockInput.pressTab()
    } else {
      testSetup.mockInput.pressKey(key)
    }
    await Bun.sleep(0)
  })

  return renderFrame(testSetup)
}

async function pressEnterAndRender(
  testSetup: Awaited<ReturnType<typeof testRender>>,
): Promise<string> {
  await act(async () => {
    testSetup.mockInput.pressEnter()
    await Bun.sleep(0)
  })

  return renderFrame(testSetup)
}

async function renderFrame(testSetup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await act(async () => {
    await Bun.sleep(0)
    await testSetup.renderOnce()
  })

  return testSetup.captureCharFrame()
}

async function enterPlanMode(rendered: Awaited<ReturnType<typeof renderTestApp>>): Promise<void> {
  await act(async () => {
    await rendered.service.enterPlanMode()
    await Bun.sleep(0)
  })

  await renderFrame(rendered.testSetup)
}
