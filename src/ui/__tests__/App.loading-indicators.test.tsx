import { afterEach, describe, expect, it, mock } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { DialogProvider } from "@opentui-ui/dialog/react"
import type { DialogId } from "@opentui-ui/dialog/react"
import { act } from "react"
import { SessionId, type AccountInfo, type ModelInfo, type SessionSummary, type SlashCommand } from "#sdk/types"
import { DEFAULT_CONFIG } from "#config/schema"
import { Keymap } from "#commands/keymap"
import { ConversationService } from "#state/conversation-service"
import { initialConversationState, type ConversationState, type SessionState } from "#state/types"
import {
  AppControllerProvider,
  ConfigProvider,
  ConversationServiceProvider,
  KeymapProvider,
  type AppController,
} from "#ui/hooks"
import { ModelPickerDialogContent } from "#ui/components/ModelPickerOverlay"
import { SessionPickerDialogContent } from "#ui/components/SessionPickerOverlay"

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

const FILTER_TEST_MODELS: readonly ModelInfo[] = [
  {
    value: "beta",
    displayName: "Beta",
    description: "Balanced model",
  },
  {
    value: "bravo",
    displayName: "Bravo",
    description: "Reasoning model",
  },
  {
    value: "charlie",
    displayName: "Charlie",
    description: "Creative model",
  },
] as const

const FILTER_TEST_SESSIONS: readonly SessionSummary[] = [
  {
    id: SessionId("session-beta"),
    title: "Beta notes",
    lastModified: new Date("2026-03-01T10:00:00Z"),
    messageCount: null,
    gitBranch: "beta/refactor",
    cwd: "/tmp/beta-worktree",
  },
  {
    id: SessionId("session-bravo"),
    title: "Bravo review",
    lastModified: new Date("2026-03-02T10:00:00Z"),
    messageCount: null,
    gitBranch: "bravo/filtering",
    cwd: "/tmp/bravo-worktree",
  },
  {
    id: SessionId("session-charlie"),
    title: "Charlie recap",
    lastModified: new Date("2026-03-03T10:00:00Z"),
    messageCount: null,
    gitBranch: "charlie/docs",
    cwd: "/tmp/charlie-worktree",
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

let renderedView:
  | Awaited<ReturnType<typeof renderAppView>>
  | Awaited<ReturnType<typeof renderModelPickerView>>
  | Awaited<ReturnType<typeof renderSessionPickerView>>
  | null = null

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

  it("shows the working loader below the input while Claude is responding", async () => {
    renderedView = await renderAppView({
      sessionState: { status: "running" },
    })

    const frame = renderedView.testSetup.captureCharFrame()

    expect(frame).toMatch(/Claude.?working/)
    expect(frame).toContain("Waiting for Claude...")
    expect(frame).not.toContain("running now")
  })

  it("shows a Claude executable failure without auth login guidance", async () => {
    renderedView = await renderAppView({
      startup: {
        auth: {
          status: "failed",
          kind: "binary",
          message: "Configured Claude executable was not found at `/tmp/missing-claude`.",
        },
        resume: { status: "idle" },
        metadata: { status: "idle" },
      },
    })

    const frame = renderedView.testSetup.captureCharFrame()

    expect(frame).toContain("Claude Code executable unavailable.")
    expect(frame).toContain("Configured Claude executable was not found")
    expect(frame).toContain("claudios config")
    expect(frame).not.toContain("needs authentication")
    expect(frame).not.toContain("claude auth login")
  })

  it("keeps login guidance for real auth failures", async () => {
    renderedView = await renderAppView({
      startup: {
        auth: {
          status: "failed",
          kind: "auth",
          message: "Claude Code authentication required.",
        },
        resume: { status: "idle" },
        metadata: { status: "idle" },
      },
    })

    const frame = renderedView.testSetup.captureCharFrame()

    expect(frame).toContain("Claude Code needs authentication.")
    expect(frame).toContain("claude auth login")
    expect(frame).not.toContain("executable unavailable")
  })

  it("shows whether the model picker input or results are active", async () => {
    renderedView = await renderModelPickerView({
      vimEnabled: true,
      vimMode: "normal",
      availableModels: TEST_MODELS,
    })

    let frame = await renderFrame(renderedView.testSetup)

    expect(frame).toContain("Results active")

    act(() => {
      renderedView?.service.setVimMode("insert")
    })

    frame = await renderFrame(renderedView.testSetup)
    expect(frame).toContain("Filter active")
  })

  it("updates model picker focus when clicked with the mouse", async () => {
    renderedView = await renderModelPickerView({
      vimEnabled: true,
      vimMode: "insert",
      availableModels: TEST_MODELS,
    })

    await act(async () => {
      await renderedView?.testSetup.mockMouse.click(4, 8)
      await Bun.sleep(0)
    })

    await renderFrame(renderedView.testSetup)
    expect(renderedView.service.getState().vimMode).toBe("normal")

    await act(async () => {
      await renderedView?.testSetup.mockMouse.click(4, 3)
      await Bun.sleep(0)
    })

    await renderFrame(renderedView.testSetup)
    expect(renderedView.service.getState().vimMode).toBe("insert")
  })

  it("keeps plain-mode picker focus local instead of mutating global vim state", async () => {
    renderedView = await renderModelPickerView({
      vimEnabled: false,
      availableModels: TEST_MODELS,
    })

    let frame = await renderFrame(renderedView.testSetup)
    expect(frame).toContain("Filter active")
    expect(renderedView.service.getState().vimMode).toBe("insert")

    await act(async () => {
      await renderedView?.testSetup.mockMouse.click(4, 8)
      await Bun.sleep(0)
    })

    frame = await renderFrame(renderedView.testSetup)
    expect(frame).toContain("Results active")
    expect(renderedView.service.getState().vimMode).toBe("insert")

    await act(async () => {
      await renderedView?.testSetup.mockMouse.click(4, 3)
      await Bun.sleep(0)
    })

    frame = await renderFrame(renderedView.testSetup)
    expect(frame).toContain("Filter active")
    expect(renderedView.service.getState().vimMode).toBe("insert")
  })

  it("filters model picker results on each typed character", async () => {
    renderedView = await renderModelPickerView({
      availableModels: FILTER_TEST_MODELS,
      initialModel: "default-model",
    })

    let frame = await renderFrame(renderedView.testSetup)
    expect(frame).toMatch(/models\s+3/)

    frame = await typeAndRender(renderedView.testSetup, "b")
    expect(frame).toMatch(/models\s+2/)
    expect(frame).toContain("Beta")
    expect(frame).toContain("Bravo")
    expect(frame).not.toContain("Charlie")

    frame = await typeAndRender(renderedView.testSetup, "r")
    expect(frame).toMatch(/models\s+1/)
    expect(frame).toContain("Bravo")
    expect(frame).not.toContain("Beta")
  })

  it("filters session picker results on each typed character", async () => {
    renderedView = await renderSessionPickerView({
      sessions: FILTER_TEST_SESSIONS,
    })

    let frame = await renderFrame(renderedView.testSetup)
    expect(frame).toMatch(/sessions\s+3/)

    frame = await typeAndRender(renderedView.testSetup, "b")
    expect(frame).toMatch(/sessions\s+2/)
    expect(frame).toContain("Beta notes")
    expect(frame).toContain("Bravo review")
    expect(frame).not.toContain("Charlie recap")

    frame = await typeAndRender(renderedView.testSetup, "r")
    expect(frame).toMatch(/sessions\s+1/)
    expect(frame).toContain("Bravo review")
    expect(frame).not.toContain("Beta notes")
  })
})

async function renderAppView(options?: {
  readonly promptText?: string
  readonly sessionState?: SessionState
  readonly startup?: ConversationState["startup"]
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
  readonly vimEnabled?: boolean
  readonly vimMode?: ConversationState["vimMode"]
  readonly availableModels?: readonly ModelInfo[]
  readonly initialModel?: string
}) {
  const initialState = options?.startup
    ? createConversationState({
        startup: options.startup,
        availableModels: options.availableModels ?? [],
        ...(options?.vimEnabled === undefined ? {} : { vimEnabled: options.vimEnabled }),
        ...(options?.vimMode === undefined ? {} : { vimMode: options.vimMode }),
      })
    : createConversationState({
        availableModels: options?.availableModels ?? [],
        ...(options?.vimEnabled === undefined ? {} : { vimEnabled: options.vimEnabled }),
        ...(options?.vimMode === undefined ? {} : { vimMode: options.vimMode }),
      })
  const service = new ConversationService(
    DEFAULT_CONFIG,
    initialState,
  )
  const testSetup = await testRender(
    <ConversationServiceProvider value={service}>
      <DialogProvider>
        <ModelPickerDialogContent
          initialModel={options?.initialModel ?? DEFAULT_CONFIG.defaultModel}
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
    { width: 100, height: 30, useMouse: true },
  )

  await renderFrame(testSetup)

  return { testSetup, service }
}

async function renderSessionPickerView(options?: {
  readonly sessions?: readonly SessionSummary[]
  readonly vimEnabled?: boolean
  readonly vimMode?: ConversationState["vimMode"]
}) {
  const service = new ConversationService(
    DEFAULT_CONFIG,
    createConversationState({
      ...(options?.vimEnabled === undefined ? {} : { vimEnabled: options.vimEnabled }),
      ...(options?.vimMode === undefined ? {} : { vimMode: options.vimMode }),
    }),
  )

  let resolveSessions: ((sessions: readonly SessionSummary[]) => void) | null = null
  service.listSessionSummaries = async () => await new Promise((resolve) => {
    resolveSessions = resolve
  })

  const testSetup = await testRender(
    <ConversationServiceProvider value={service}>
      <DialogProvider>
        <SessionPickerDialogContent
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

  await act(async () => {
    await testSetup.renderOnce()
    await Bun.sleep(0)
    resolveSessions?.(options?.sessions ?? [])
    await Bun.sleep(0)
    await testSetup.renderOnce()
  })

  return { testSetup, service }
}

function createReadyConversationState(options?: {
  readonly promptText?: string
  readonly sessionState?: SessionState
  readonly startup?: ConversationState["startup"]
}): ConversationState {
  const baseState = {
    availableModels: TEST_MODELS,
    availableCommands: TEST_COMMANDS,
    account: TEST_ACCOUNT,
    ...(options?.sessionState ? { sessionState: options.sessionState } : {}),
    startup: options?.startup ?? {
      auth: { status: "ready" as const },
      resume: { status: "ready" as const },
      metadata: { status: "ready" as const },
    },
  }

  return options?.promptText === undefined
    ? createConversationState(baseState)
    : createConversationState({
        ...baseState,
        promptText: options.promptText,
      })
}

function createConversationState(overrides?: {
  readonly promptText?: string
  readonly availableModels?: readonly ModelInfo[]
  readonly availableCommands?: readonly SlashCommand[]
  readonly account?: AccountInfo | null
  readonly sessionState?: SessionState
  readonly startup?: ConversationState["startup"]
  readonly vimEnabled?: boolean
  readonly vimMode?: ConversationState["vimMode"]
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
    showThinking: DEFAULT_CONFIG.showThinking,
    vimEnabled: overrides?.vimEnabled ?? false,
    vimMode: overrides?.vimMode ?? "insert",
    sessionState: overrides?.sessionState ?? initialConversationState.sessionState,
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
