/**
 * App — root component assembling the 4-zone layout.
 *
 * +------------------------------------------+
 * | Header: model | session | tokens          |
 * +------------------------------------------+
 * |  Message area (scrollbox, flexGrow=1)     |
 * +------------------------------------------+
 * | > prompt input                            |
 * +------------------------------------------+
 * | Status: vim mode | cost | keybind hints   |
 * +------------------------------------------+
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { InputRenderable, KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { DialogProvider, useDialog, useDialogState } from "@opentui-ui/dialog/react"
import type { ConfirmContext, PromptContext, AlertContext } from "@opentui-ui/dialog/react"
import { Toaster, toast } from "@opentui-ui/toast/react"
import {
  isPermissionModeName,
  listSlashCommandSuggestions,
  PERMISSION_MODES,
  resolveComposerSubmission,
  shouldSubmitSlashSuggestion,
} from "#commands/slash"
import type { ParsedLocalSlashCommand, SlashCommandSuggestion } from "#commands/slash"
import {
  useAppController,
  useConversationService,
  useConversationSelector,
  useKeymap,
  useThemePalette,
} from "#ui/hooks"
import { Header } from "#ui/components/Header"
import { MessageArea } from "#ui/components/MessageArea"
import { PromptInput } from "#ui/components/PromptInput"
import { StatusBar } from "#ui/components/StatusBar"
import { CompletionOverlay } from "#ui/components/CompletionOverlay"
import { PermissionDialogContent } from "#ui/components/PermissionModal"
import { ModelPickerDialogContent } from "#ui/components/ModelPickerOverlay"
import { SessionPickerDialogContent } from "#ui/components/SessionPickerOverlay"
import { KeymapHelpContent } from "#ui/components/KeymapHelpOverlay"
import { getSlashPickerQuery } from "#ui/slash-picker"
import { listWorkspaceFiles } from "#ui/workspace-files"
import { handleNormalModeKey, type VimPendingOperator } from "#ui/vim"
import { resolvePickerKeyboardAction } from "#ui/picker-keyboard"
import { THEME_NAMES, isThemeName, createDialogTheme, createToasterOptions } from "#ui/theme"

type FilePickerOption = {
  readonly name: string
  readonly description: string
  readonly value: string
}

type Picker =
  | {
      readonly kind: "file"
      readonly title: string
      readonly loading: boolean
      readonly options: readonly FilePickerOption[]
    }
  | {
      readonly kind: "slash"
      readonly title: string
      readonly options: readonly SlashCommandSuggestion[]
    }

type SetModelResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string }

export function App() {
  return (
    <DialogProvider>
      <AppContent />
    </DialogProvider>
  )
}

function AppContent() {
  const appController = useAppController()
  const service = useConversationService()
  const keymap = useKeymap()
  const theme = useThemePalette()
  const dialog = useDialog()
  const isDialogOpen = useDialogState((s) => s.isOpen)
  const vimMode = useConversationSelector((s) => s.vimMode)
  const currentModel = useConversationSelector((s) => s.model)
  const sessionState = useConversationSelector((s) => s.sessionState)
  const startup = useConversationSelector((s) => s.startup)
  const promptText = useConversationSelector((s) => s.promptText)
  const availableCommands = useConversationSelector((s) => s.availableCommands)
  const availableModels = useConversationSelector((s) => s.availableModels)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [workspaceFiles, setWorkspaceFiles] = useState<readonly string[]>([])
  const [workspaceFilesLoaded, setWorkspaceFilesLoaded] = useState(false)
  const [pendingOperator, setPendingOperator] = useState<VimPendingOperator>(null)
  const inputRef = useRef<InputRenderable | null>(null)
  const messageAreaRef = useRef<ScrollBoxRenderable | null>(null)

  const dialogTheme = useMemo(() => createDialogTheme(theme), [theme])
  const toasterOptions = useMemo(() => createToasterOptions(theme), [theme])

  const canSubmitPrompt =
    startup.auth.status === "ready" && startup.resume.status !== "loading"

  const activeFileToken = useMemo(() => getActiveFileToken(promptText), [promptText])
  const slashPickerQuery = useMemo(() => getSlashPickerQuery(promptText), [promptText])

  const picker = useMemo<Picker | null>(() => {
    if (activeFileToken) {
      const query = activeFileToken.query.toLowerCase()
      const options = workspaceFiles
        .filter((filePath) => {
          if (!query) return true
          return filePath.toLowerCase().includes(query)
        })
        .slice(0, 50)
        .map((filePath) => ({
          name: `@${filePath}`,
          description: filePath,
          value: replaceActiveFileToken(promptText, activeFileToken.startIndex, filePath),
        }))
      const loading = !workspaceFilesLoaded

      return loading || options.length > 0
        ? { kind: "file" as const, title: "Files", loading, options }
        : null
    }

    if (slashPickerQuery !== null) {
      const options = listSlashCommandSuggestions(slashPickerQuery, availableCommands)

      return options.length > 0
        ? { kind: "slash" as const, title: "Slash Commands", options }
        : null
    }

    return null
  }, [
    activeFileToken,
    availableCommands,
    promptText,
    slashPickerQuery,
    workspaceFiles,
    workspaceFilesLoaded,
  ])

  useEffect(() => {
    setSelectedIndex(0)
  }, [activeFileToken?.query, picker?.kind, picker?.options.length, slashPickerQuery])

  useEffect(() => {
    if (vimMode !== "normal") {
      setPendingOperator(null)
    }
  }, [vimMode])

  // When a permission request arrives, dismiss any open dialogs
  useEffect(() => {
    if (sessionState.status === "awaiting_permission") {
      dialog.closeAll()
    }
  }, [dialog, sessionState.status])

  useEffect(() => {
    if (startup.auth.status !== "ready") return
    void service.loadSupportedMetadata()
  }, [service, startup.auth.status])

  useEffect(() => {
    if (!activeFileToken || workspaceFilesLoaded) return

    let cancelled = false

    void listWorkspaceFiles(process.cwd())
      .then((files) => {
        if (!cancelled) {
          setWorkspaceFiles(files)
          setWorkspaceFilesLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceFiles([])
          setWorkspaceFilesLoaded(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeFileToken, workspaceFilesLoaded])

  // -------------------------------------------------------------------------
  // Permission dialog (imperative, triggered by state change)
  // -------------------------------------------------------------------------

  usePermissionDialog()

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const applyPickerSelection = useCallback(() => {
    if (!picker) return
    const option = picker.options[selectedIndex]
    if (!option) return
    service.setPromptText(option.value)
    service.setVimMode("insert")
  }, [picker, selectedIndex, service])

  const applyModelChange = useCallback(
    async (nextModel: string): Promise<SetModelResult> => {
      try {
        await service.setModel(nextModel)
        toast.success(`Model set to ${nextModel}`)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: getErrorMessage(error) }
      }
    },
    [service],
  )

  const openKeymapHelp = useCallback(() => {
    dialog.closeAll()
    void dialog.alert({
      content: ({ dismiss, dialogId }: AlertContext) => (
        <KeymapHelpContent
          bindings={keymap.allBindings()}
          dismiss={dismiss}
          dialogId={dialogId}
        />
      ),
      size: "large",
    })
  }, [dialog, keymap])

  const openSessionPicker = useCallback(async () => {
    dialog.closeAll()

    const selectedSessionId = await dialog.prompt<string>({
      content: ({ resolve, dismiss, dialogId }: PromptContext<string>) => (
        <SessionPickerDialogContent
          resolve={resolve}
          dismiss={dismiss}
          dialogId={dialogId}
        />
      ),
      size: "large",
      closeOnEscape: true,
    })

    if (selectedSessionId) {
      try {
        await service.loadSession(selectedSessionId)
        service.setVimMode("insert")
      } catch (error) {
        toast.error(`Failed to resume session: ${getErrorMessage(error)}`)
      }
    }
  }, [dialog, service])

  const openModelPicker = useCallback(async () => {
    dialog.closeAll()

    const selectedModel = await dialog.prompt<string>({
      content: ({ resolve, dismiss, dialogId }: PromptContext<string>) => (
        <ModelPickerDialogContent
          initialModel={currentModel}
          resolve={resolve}
          dismiss={dismiss}
          dialogId={dialogId}
        />
      ),
      size: "large",
      closeOnEscape: true,
    })

    if (selectedModel) {
      const result = await applyModelChange(selectedModel)
      if (!result.ok) {
        toast.error(`Failed to set model: ${result.error}`)
      }
    }
  }, [applyModelChange, currentModel, dialog])

  const runLocalSlashCommand = useCallback(
    async (command: ParsedLocalSlashCommand) => {
      switch (command.name) {
        case "q": {
          await appController.quit()
          return
        }

        case "new": {
          await service.newSession()
          return
        }

        case "sessions": {
          await openSessionPicker()
          return
        }

        case "clear": {
          service.clearMessages()
          return
        }

        case "model": {
          const nextModel = command.args.join(" ").trim()
          if (!nextModel) {
            const choices = availableModels.map((model) => model.value).join(", ")
            service.appendSystemMessage(
              choices ? `Available models: ${choices}` : "No models reported by the SDK yet.",
            )
            return
          }
          const result = await applyModelChange(nextModel)
          if (!result.ok) {
            toast.error(`Failed to set model: ${result.error}`)
          }
          return
        }

        case "perm": {
          const nextMode = command.args.join(" ").trim()
          if (!nextMode) {
            service.appendSystemMessage(
              `Permission modes: ${PERMISSION_MODES.join(", ")}`,
            )
            return
          }

          if (!isPermissionModeName(nextMode)) {
            toast.error(
              `Invalid permission mode: ${nextMode}. Expected one of ${PERMISSION_MODES.join(", ")}`,
            )
            return
          }

          await service.setPermissionMode(nextMode)
          toast.success(`Permission mode: ${nextMode}`)
          return
        }

        case "theme": {
          const nextTheme = command.args.join(" ").trim()
          if (!nextTheme) {
            service.appendSystemMessage(`Themes: ${THEME_NAMES.join(", ")}`)
            return
          }

          if (!isThemeName(nextTheme)) {
            toast.error(
              `Invalid theme: ${nextTheme}. Expected one of ${THEME_NAMES.join(", ")}`,
            )
            return
          }

          service.setTheme(nextTheme)
          toast.success(`Theme: ${nextTheme}`)
          return
        }

        case "diff": {
          const nextMode = service.toggleDiffMode()
          toast.info(`Diff mode: ${nextMode}`)
          return
        }

        case "keys": {
          openKeymapHelp()
          return
        }
      }
    },
    [appController, applyModelChange, availableModels, openKeymapHelp, openSessionPicker, service],
  )

  const submitComposer = useCallback(() => {
    if (!canSubmitPrompt) {
      return
    }

    const submission = resolveComposerSubmission(promptText)
    if (submission.kind === "empty") {
      return
    }

    if (submission.kind === "local_command") {
      service.setPromptText("")
      void runLocalSlashCommand(submission.command).catch((error) => {
        toast.error(getErrorMessage(error))
      })
      return
    }

    void service.submitCurrentPrompt()
  }, [canSubmitPrompt, promptText, runLocalSlashCommand, service])

  const syncPromptTextFromInput = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    service.setPromptText(input.value)
  }, [service])

  const handleAction = useCallback(
    (action: string) => {
      switch (action) {
        case "quit":
          void appController.quit()
          break
        case "session.new":
          void service.newSession()
          break
        case "session.openPicker":
          void openSessionPicker()
          break
        case "model.openPicker":
          void openModelPicker()
          break
        case "messages.clear":
          service.clearMessages()
          break
        case "scroll.halfPageDown":
          messageAreaRef.current?.scrollBy(0.5, "viewport")
          break
        case "scroll.halfPageUp":
          messageAreaRef.current?.scrollBy(-0.5, "viewport")
          break
        case "scroll.pageDown":
          messageAreaRef.current?.scrollBy(1, "viewport")
          break
        case "scroll.pageUp":
          messageAreaRef.current?.scrollBy(-1, "viewport")
          break
        case "scroll.top":
          messageAreaRef.current?.scrollTo(0)
          break
        case "scroll.bottom":
          if (messageAreaRef.current) {
            messageAreaRef.current.scrollTo(messageAreaRef.current.scrollHeight)
          }
          break
        case "editor.open":
          void appController.openEditor(promptText).then((value) => {
            if (value !== null) {
              service.setPromptText(value)
              service.setVimMode("insert")
            }
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            toast.error(`Editor failed: ${message}`)
          })
          break
        case "mode.normal":
          setPendingOperator(null)
          service.setVimMode("normal")
          break
        case "mode.insert":
          setPendingOperator(null)
          service.setVimMode("insert")
          break
        case "mode.insertAfter":
          setPendingOperator(null)
          inputRef.current?.moveCursorRight()
          service.setVimMode("insert")
          break
        case "mode.insertEnd":
          setPendingOperator(null)
          inputRef.current?.gotoLineEnd()
          service.setVimMode("insert")
          break
        case "mode.insertStart":
          setPendingOperator(null)
          inputRef.current?.gotoLineHome()
          service.setVimMode("insert")
          break
        case "prompt.submit":
          submitComposer()
          break
        case "keys.help":
          openKeymapHelp()
          break
        case "permission.allow":
          service.resolvePermission(true)
          break
        case "permission.deny":
          service.resolvePermission(false)
          break
        default:
          break
      }
    },
    [
      appController,
      openKeymapHelp,
      openModelPicker,
      openSessionPicker,
      promptText,
      service,
      submitComposer,
    ],
  )

  useKeyboard((key) => {
    // When a dialog is open, let the dialog handle its own keyboard via useDialogKeyboard.
    // Only exception: permission awaiting state uses keymap for allow/deny.
    if (isDialogOpen && sessionState.status !== "awaiting_permission") {
      return
    }

    if (sessionState.status !== "awaiting_permission") {
      if (vimMode === "normal") {
        if (key.name === "escape") {
          setPendingOperator(null)
          return
        }

        if (isPromptTriggerKey(key, "/")) {
          setPendingOperator(null)
          service.setPromptText("/")
          service.setVimMode("insert")
          return
        }

        const vimResult = handleNormalModeKey(inputRef.current, key, pendingOperator)
        if (vimResult.handled) {
          setPendingOperator(vimResult.nextOperator)
          syncPromptTextFromInput()
          if (vimResult.enterInsertMode) {
            service.setVimMode("insert")
          }
          return
        }
      }

      if (vimMode === "insert" && shouldSyncPromptTextFromKey(key)) {
        queueMicrotask(syncPromptTextFromInput)
      }

      if (picker) {
        const pickerAction = resolvePickerKeyboardAction(key, vimMode)
        switch (pickerAction.kind) {
          case "move":
            setSelectedIndex((current) => {
              const next = current + pickerAction.delta
              return Math.max(0, Math.min(next, picker.options.length - 1))
            })
            return
          case "select": {
            if (picker.kind === "slash") {
              const selectedOption = picker.options[selectedIndex]
              if (selectedOption && shouldSubmitSlashSuggestion(promptText, selectedOption)) {
                submitComposer()
                return
              }
            }

            if (!picker.options[selectedIndex]) {
              return
            }

            applyPickerSelection()
            return
          }
          case "close":
            // Clear prompt to dismiss the picker
            service.setPromptText("")
            service.setVimMode("normal")
            return
          case "setMode":
            service.setVimMode(pickerAction.mode)
            return
          case "none":
            break
        }
      }
    }

    const keyStr = getKeyBindingString(key)
    if (key.repeated && keyStr === "?" && vimMode === "normal") {
      return
    }

    const context =
      sessionState.status === "awaiting_permission" ? "modal" as const : "global" as const

    const action = keymap.resolve(keyStr, context, vimMode)
    if (action) {
      handleAction(action)
    }
  })

  return (
    <>
      <box flexDirection="column" height="100%" backgroundColor={theme.shell}>
        <Header />
        <box flexGrow={1} flexShrink={1} minHeight={0}>
          <MessageArea scrollRef={messageAreaRef} />
        </box>
        <PromptInput
          canSubmit={canSubmitPrompt}
          hasModalFocus={isDialogOpen}
          inputRef={inputRef}
          onSubmit={() => {
            if (!picker) {
              submitComposer()
            }
          }}
        />
        <StatusBar />
        {picker && !isDialogOpen ? (
          <CompletionOverlay
            title={picker.title}
            options={picker.options}
            selectedIndex={selectedIndex}
            loading={picker.kind === "file" ? picker.loading : false}
          />
        ) : null}
      </box>
      <Toaster {...toasterOptions} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Permission dialog hook
// ---------------------------------------------------------------------------

function usePermissionDialog() {
  const dialog = useDialog()
  const service = useConversationService()
  const sessionState = useConversationSelector((s) => s.sessionState)
  const permissionRequestRef = useRef<string | null>(null)

  useEffect(() => {
    if (sessionState.status !== "awaiting_permission") {
      permissionRequestRef.current = null
      return
    }

    const { toolName, toolInput } = sessionState.request
    const requestKey = `${toolName}:${JSON.stringify(toolInput)}`

    // Prevent double-opening for the same request
    if (permissionRequestRef.current === requestKey) return
    permissionRequestRef.current = requestKey

    void dialog.confirm({
      content: ({ resolve, dismiss, dialogId }: ConfirmContext) => (
        <PermissionDialogContent
          toolName={toolName}
          toolInput={toolInput}
          resolve={resolve}
          dismiss={dismiss}
          dialogId={dialogId}
        />
      ),
      size: "medium",
      fallback: false,
      closeOnEscape: true,
    }).then((allowed) => {
      service.resolvePermission(allowed)
    })
  }, [dialog, service, sessionState])
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function getKeyBindingString(key: KeyEvent): string {
  if (!key.ctrl && !key.meta && isPrintableKeySequence(key.sequence)) {
    return key.sequence
  }

  const parts: string[] = []
  if (key.ctrl) parts.push("ctrl")
  if (key.meta) parts.push("alt")
  if (key.shift && key.name.length > 1) parts.push("shift")
  parts.push(key.name)
  return parts.join("+")
}

function isPrintableKeySequence(sequence: string): boolean {
  return sequence.length === 1 && sequence >= " " && sequence <= "~"
}

function isPromptTriggerKey(
  key: KeyEvent,
  expected: "/",
): boolean {
  return key.name === expected || key.sequence === expected
}

function shouldSyncPromptTextFromKey(
  key: Pick<KeyEvent, "name" | "sequence" | "ctrl" | "meta">,
): boolean {
  if (key.ctrl || key.meta) {
    return false
  }

  return isPrintableKeySequence(key.sequence) || key.name === "backspace" || key.name === "delete"
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getActiveFileToken(
  promptText: string,
): { readonly query: string; readonly startIndex: number } | null {
  const match = /(^|\s)@([^\s]*)$/.exec(promptText)
  if (!match) return null

  const prefix = match[1] ?? ""
  const query = match[2] ?? ""
  return {
    query,
    startIndex: promptText.length - query.length - 1,
  }
}

function replaceActiveFileToken(
  promptText: string,
  startIndex: number,
  filePath: string,
): string {
  const before = promptText.slice(0, startIndex)
  return `${before}@${filePath} `
}
