import { afterEach, describe, expect, it, mock } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { DialogProvider } from "@opentui-ui/dialog/react"
import type { DialogId } from "@opentui-ui/dialog/react"
import { act } from "react"
import type { AccountInfo, ModelInfo, SlashCommand } from "#sdk/types"
import { DEFAULT_CONFIG } from "#config/schema"
import { Keymap } from "#commands/keymap"
import { ConversationService } from "#state/conversation-service"
import { initialConversationState, type ConversationState } from "#state/types"
import {
  AppControllerProvider,
  ConfigProvider,
  ConversationServiceProvider,
  KeymapProvider,
  type AppController,
} from "#ui/hooks"
import { ModelPickerDialogContent } from "#ui/components/ModelPickerOverlay"

const pendingWorkspaceFiles = new Promise<readonly string[]>(() => {
  return
})

mock.module("#ui/workspace-files", () => ({
  listWorkspaceFiles: async () => pendingWorkspaceFiles,
}))

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

const TEST_COMMANDS: readonly SlashCommand[] = [
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

let renderedView: Awaited<ReturnType<typeof renderAppView>> | Awaited<ReturnType<typeof renderModelPickerView>> | null = null

afterEach(() => {
  if (renderedView) {
    act(() => {
      renderedView?.testSetup.renderer.destroy()
    })
    renderedView = null
  }
})

describe("loading indicators", () => {
  it("keeps the file picker overlay visible while workspace files are indexing", async () => {
    renderedView = await renderAppView({ promptText: "@" })

    const frame = renderedView.testSetup.captureCharFrame()

    expect(frame).toContain("files")
    expect(frame).toContain("Loading files...")
  })

  it("shows a loading branch in the model picker while metadata is pending", async () => {
    renderedView = await renderModelPickerView({
      startup: {
        auth: { status: "ready" },
        resume: { status: "ready" },
        metadata: { status: "loading" },
      },
    })

    const frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("models")
    expect(frame).toContain("Loading models...")
  })
})

async function renderAppView(options?: {
  readonly promptText?: string
}) {
  const { App } = await import("#ui/App")
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
    { width: 100, height: 30 },
  )

  await act(async () => {
    await testSetup.renderOnce()
  })

  return { testSetup, service }
}

async function renderModelPickerView(options?: {
  readonly startup?: ConversationState["startup"]
}) {
  const initialState = options?.startup
    ? createConversationState({
        startup: options.startup,
        availableModels: [],
      })
    : createConversationState({
        availableModels: [],
      })
  const service = new ConversationService(
    DEFAULT_CONFIG,
    initialState,
  )
  const testSetup = await testRender(
    <ConversationServiceProvider value={service}>
      <DialogProvider>
        <ModelPickerDialogContent
          initialModel={DEFAULT_CONFIG.defaultModel}
          resolve={() => {
            return
          }}
          dismiss={() => {
            return
          }}
          dialogId={"test-dialog" as DialogId}
        />
      </DialogProvider>
    </ConversationServiceProvider>,
    { width: 100, height: 30 },
  )

  await renderFrame(testSetup)

  return { testSetup, service }
}

function createReadyConversationState(options?: {
  readonly promptText?: string
}): ConversationState {
  return options?.promptText === undefined
    ? createConversationState({
        availableModels: TEST_MODELS,
        availableCommands: TEST_COMMANDS,
        account: TEST_ACCOUNT,
        startup: {
          auth: { status: "ready" },
          resume: { status: "ready" },
          metadata: { status: "ready" },
        },
      })
    : createConversationState({
        promptText: options.promptText,
        availableModels: TEST_MODELS,
        availableCommands: TEST_COMMANDS,
        account: TEST_ACCOUNT,
        startup: {
          auth: { status: "ready" },
          resume: { status: "ready" },
          metadata: { status: "ready" },
        },
      })
}

function createConversationState(overrides?: {
  readonly promptText?: string
  readonly availableModels?: readonly ModelInfo[]
  readonly availableCommands?: readonly SlashCommand[]
  readonly account?: AccountInfo | null
  readonly startup?: ConversationState["startup"]
}): ConversationState {
  return {
    ...initialConversationState,
    startup: overrides?.startup ?? {
      auth: { status: "ready" },
      resume: { status: "ready" },
      metadata: { status: "ready" },
    },
    promptText: overrides?.promptText ?? "",
    model: DEFAULT_CONFIG.defaultModel,
    permissionMode: DEFAULT_CONFIG.defaultPermissionMode,
    themeName: DEFAULT_CONFIG.theme,
    diffMode: DEFAULT_CONFIG.diffMode,
    vimMode: "insert",
    availableModels: overrides?.availableModels ?? TEST_MODELS,
    availableCommands: overrides?.availableCommands ?? TEST_COMMANDS,
    account: overrides?.account ?? TEST_ACCOUNT,
  }
}

async function renderFrame(testSetup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await act(async () => {
    await Bun.sleep(0)
    await testSetup.renderOnce()
  })

  return testSetup.captureCharFrame()
}
