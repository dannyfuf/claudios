import { afterEach, describe, expect, it } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import type { SlashCommand, ModelInfo, AccountInfo } from "#sdk/types"
import { DEFAULT_CONFIG } from "#config/schema"
import { Keymap } from "#commands/keymap"
import { ConversationService } from "#state/conversation-service"
import {
  getInteractionMode,
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
  {
    name: "review",
    description: "Review a file",
    argumentHint: "<path>",
  },
  {
    name: "cost",
    description: "Show total cost and duration",
    argumentHint: "",
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

describe("App slash picker", () => {
  it("opens, filters, broadens, and closes while typing in plain mode", async () => {
    renderedApp = await renderTestApp()

    let frame = await typeAndRender(renderedApp.testSetup, "/")
    expect(frame).toContain("slash commands")
    expect(frame).toContain("/clear")
    expect(frame).toContain("/cost")
    expect(frame).toContain("/mcp")

    frame = await typeAndRender(renderedApp.testSetup, "p")
    expect(renderedApp.service.getState().promptText).toBe("/p")
    expect(frame).toContain("slash commands")
    expect(frame).toMatch(/slash commands\s+3/)
    expect(frame).toContain("/perm")
    expect(frame).not.toContain("/clear")

    frame = await typeAndRender(renderedApp.testSetup, "l")
    expect(renderedApp.service.getState().promptText).toBe("/pl")
    expect(frame).toMatch(/slash commands\s+2/)
    expect(frame).not.toContain("/perm")

    frame = await pressBackspaceAndRender(renderedApp.testSetup)
    expect(renderedApp.service.getState().promptText).toBe("/p")
    expect(frame).toMatch(/slash commands\s+3/)
    expect(frame).toContain("/perm")

    frame = await pressBackspaceAndRender(renderedApp.testSetup)
    expect(renderedApp.service.getState().promptText).toBe("/")
    expect(frame).toContain("/clear")

    frame = await typeAndRender(renderedApp.testSetup, "perm ")
    expect(renderedApp.service.getState().promptText).toBe("/perm ")
    expect(frame).not.toContain("slash commands")
  })

  it("does not open when slash is typed after other plain-mode text", async () => {
    renderedApp = await renderTestApp({ promptText: "hello" })

    const frame = await typeAndRender(renderedApp.testSetup, "/")

    expect(renderedApp.service.getState().promptText).toBe("hello/")
    expect(frame).not.toContain("slash commands")
  })

  it("opens from normal mode and returns to insert mode when slash is pressed", async () => {
    renderedApp = await renderTestApp({ vimEnabled: true, vimMode: "normal" })

    const frame = await pressKeyAndRender(renderedApp.testSetup, "/")

    expect(renderedApp.service.getState().vimEnabled).toBe(true)
    expect(renderedApp.service.getState().vimMode).toBe("insert")
    expect(renderedApp.service.getState().promptText).toBe("/")
    expect(frame).toContain("slash commands")
    expect(frame).toContain("/clear")
  })

  it("shows /cost in picker when typing /c", async () => {
    renderedApp = await renderTestApp()

    const frame = await typeAndRender(renderedApp.testSetup, "/c")
    expect(frame).toContain("slash commands")
    expect(frame).toContain("/cost")
  })

  it("shows argument hint in picker description for sdk commands with hints", async () => {
    renderedApp = await renderTestApp()

    const frame = await typeAndRender(renderedApp.testSetup, "/pl")
    expect(frame).toContain("/plan")
    expect(frame).toContain("<task>")
  })

  it("moves slash completion selection after entering normal mode", async () => {
    renderedApp = await renderTestApp({ vimEnabled: true, vimMode: "normal" })

    let frame = await pressKeyAndRender(renderedApp.testSetup, "/")
    expect(renderedApp.service.getState().vimMode).toBe("insert")
    expect(frame).toContain("slash commands")

    frame = await typeAndRender(renderedApp.testSetup, "c")
    expect(renderedApp.service.getState().promptText).toBe("/c")
    expect(frame).toContain("/clear")
    expect(frame).toContain("/cost")

    await pressKeyAndRender(renderedApp.testSetup, "escape")
    expect(renderedApp.service.getState().vimMode).toBe("normal")

    await pressKeyAndRender(renderedApp.testSetup, "j")
    await pressKeyAndRender(renderedApp.testSetup, "enter")

    expect(renderedApp.service.getState().promptText).toBe("/cost")
    expect(renderedApp.service.getState().vimMode).toBe("insert")
  })

  it("opens help from plain mode on ctrl+slash", async () => {
    renderedApp = await renderTestApp({ promptText: "hello", kittyKeyboard: true })

    const frame = await pressModifiedKeyAndRender(renderedApp.testSetup, "/", {
      ctrl: true,
      shift: true,
    })

    expect(renderedApp.service.getState().promptText).toBe("hello")
    expect(frame).toContain("keymaps")
    expect(frame).toContain("bindings")
  })

  it("toggles vim on and off through the local slash command", async () => {
    renderedApp = await renderTestApp()

    await typeAndRender(renderedApp.testSetup, "/vim")
    await pressKeyAndRender(renderedApp.testSetup, "enter")

    expect(renderedApp.service.getState().vimEnabled).toBe(true)
    expect(getInteractionMode(renderedApp.service.getState())).toBe("insert")
    expect(renderedApp.service.getState().promptText).toBe("")

    await typeAndRender(renderedApp.testSetup, "/vim off")
    await pressKeyAndRender(renderedApp.testSetup, "enter")

    expect(renderedApp.service.getState().vimEnabled).toBe(false)
    expect(getInteractionMode(renderedApp.service.getState())).toBe("plain")
    expect(renderedApp.service.getState().promptText).toBe("")
  })

  it("interrupts a running request after pressing escape twice", async () => {
    let interruptCalls = 0
    renderedApp = await renderTestApp({
      sessionState: { status: "running" },
      onInterrupt: async () => {
        interruptCalls += 1
      },
    })

    await pressKeyAndRender(renderedApp.testSetup, "escape")

    expect(renderedApp.service.getState().vimEnabled).toBe(false)
    expect(getInteractionMode(renderedApp.service.getState())).toBe("plain")
    expect(interruptCalls).toBe(0)

    await pressKeyAndRender(renderedApp.testSetup, "escape")

    expect(interruptCalls).toBe(1)
  })

  it("only counts unconsumed escape presses toward request interruption", async () => {
    let interruptCalls = 0
    renderedApp = await renderTestApp({
      promptText: "hello",
      vimEnabled: true,
      vimMode: "normal",
      sessionState: { status: "running" },
      onInterrupt: async () => {
        interruptCalls += 1
      },
    })

    await pressKeyAndRender(renderedApp.testSetup, "d")
    await pressKeyAndRender(renderedApp.testSetup, "escape")
    expect(interruptCalls).toBe(0)

    await pressKeyAndRender(renderedApp.testSetup, "escape")
    expect(interruptCalls).toBe(0)

    await pressKeyAndRender(renderedApp.testSetup, "escape")
    expect(interruptCalls).toBe(1)
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
  readonly onInterrupt?: () => Promise<void> | void
  readonly kittyKeyboard?: boolean
}) {
  const service = new ConversationService(DEFAULT_CONFIG, createReadyConversationState(options))
  if (options?.onInterrupt) {
    service.interrupt = async () => {
      await options.onInterrupt?.()
    }
  }
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
      ...(options?.kittyKeyboard === undefined ? {} : { kittyKeyboard: options.kittyKeyboard }),
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

async function pressBackspaceAndRender(
  testSetup: Awaited<ReturnType<typeof testRender>>,
): Promise<string> {
  await act(async () => {
    testSetup.mockInput.pressBackspace()
    await Bun.sleep(0)
  })

  return renderFrame(testSetup)
}

async function pressKeyAndRender(
  testSetup: Awaited<ReturnType<typeof testRender>>,
  key: string,
): Promise<string> {
  await act(async () => {
    if (key === "escape") {
      testSetup.mockInput.pressEscape()
      await Bun.sleep(20)
    } else if (key === "enter") {
      testSetup.mockInput.pressEnter()
      await Bun.sleep(0)
    } else {
      testSetup.mockInput.pressKey(key)
      await Bun.sleep(0)
    }
  })

  return renderFrame(testSetup)
}

async function pressModifiedKeyAndRender(
  testSetup: Awaited<ReturnType<typeof testRender>>,
  key: string,
  modifiers: {
    readonly shift?: boolean
    readonly ctrl?: boolean
    readonly meta?: boolean
    readonly super?: boolean
    readonly hyper?: boolean
  },
): Promise<string> {
  await act(async () => {
    testSetup.mockInput.pressKey(key, modifiers)
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
