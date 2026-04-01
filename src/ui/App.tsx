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

import { useEffect, useMemo, useRef, useState } from "react"
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { DialogProvider, useDialogState } from "@opentui-ui/dialog/react"
import { Toaster } from "@opentui-ui/toast/react"
import { getActiveFileToken, getPickerState, type Picker } from "#ui/app/picker-state"
import { useAppActions } from "#ui/app/useAppActions"
import { useAppDialogs } from "#ui/app/useAppDialogs"
import { useAppKeyboard } from "#ui/app/useAppKeyboard"
import { usePermissionDialog } from "#ui/app/usePermissionDialog"
import { useWorkspaceFiles } from "#ui/app/useWorkspaceFiles"
import { CompletionOverlay } from "#ui/components/CompletionOverlay"
import { Header } from "#ui/components/Header"
import { MessageArea } from "#ui/components/MessageArea"
import { PromptInput } from "#ui/components/PromptInput"
import { StatusBar } from "#ui/components/StatusBar"
import {
  useAppController,
  useConversationService,
  useConversationSelector,
  useKeymap,
  useThemePalette,
} from "#ui/hooks"
import { getSlashPickerQuery } from "#ui/slash-picker"
import { createToasterOptions } from "#ui/theme"
import { type VimPendingOperator } from "#ui/vim"
import { matchesInteractionMode, useInteractionMode } from "#ui/vim-mode"

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
  const isDialogOpen = useDialogState((state) => state.isOpen)
  const vimEnabled = useConversationSelector((state) => state.vimEnabled)
  const interactionMode = useInteractionMode()
  const sessionState = useConversationSelector((state) => state.sessionState)
  const startup = useConversationSelector((state) => state.startup)
  const promptText = useConversationSelector((state) => state.promptText)
  const availableCommands = useConversationSelector((state) => state.availableCommands)
  const availableModels = useConversationSelector((state) => state.availableModels)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pendingOperator, setPendingOperator] = useState<VimPendingOperator>(null)
  const inputRef = useRef<InputRenderable | null>(null)
  const messageAreaRef = useRef<ScrollBoxRenderable | null>(null)
  const pendingEscapeInterruptRef = useRef<number | null>(null)
  const isNormalInteractionMode = matchesInteractionMode(interactionMode, "normal")

  const toasterOptions = useMemo(() => createToasterOptions(theme), [theme])
  const canSubmitPrompt =
    startup.auth.status === "ready" && startup.resume.status !== "loading"
  const availableModelValues = useMemo(
    () => availableModels.map((model) => model.value),
    [availableModels],
  )
  const activeFileToken = useMemo(() => getActiveFileToken(promptText), [promptText])
  const slashPickerQuery = useMemo(() => getSlashPickerQuery(promptText), [promptText])
  const { workspaceFiles, workspaceFilesLoaded } = useWorkspaceFiles(activeFileToken)

  const picker = useMemo<Picker | null>(
    () => getPickerState({
      promptText,
      availableCommands,
      workspaceFiles,
      workspaceFilesLoaded,
    }),
    [availableCommands, promptText, workspaceFiles, workspaceFilesLoaded],
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [activeFileToken?.query, picker?.kind, picker?.options.length, slashPickerQuery])

  useEffect(() => {
    if (!isNormalInteractionMode) {
      setPendingOperator(null)
    }
  }, [isNormalInteractionMode])

  useEffect(() => {
    if (sessionState.status !== "running" || isDialogOpen) {
      pendingEscapeInterruptRef.current = null
    }
  }, [isDialogOpen, sessionState.status])

  useEffect(() => {
    if (startup.auth.status !== "ready") {
      return
    }

    void service.loadSupportedMetadata()
  }, [service, startup.auth.status])

  usePermissionDialog()

  const dialogs = useAppDialogs()
  const actions = useAppActions({
    appController,
    dialogs,
    availableModelValues,
    canSubmitPrompt,
    inputRef,
    messageAreaRef,
    pendingEscapeInterruptRef,
    picker,
    promptText,
    service,
    setPendingOperator,
    vimEnabled,
  })

  useAppKeyboard({
    clearPendingEscapeInterrupt: actions.clearPendingEscapeInterrupt,
    handleAction: actions.handleAction,
    inputRef,
    interruptRunningRequest: actions.interruptRunningRequest,
    interactionMode,
    isDialogOpen,
    isNormalInteractionMode,
    keymap,
    pendingEscapeInterruptRef,
    pendingOperator,
    picker,
    promptText,
    selectedIndex,
    selectPickerOption: actions.selectPickerOption,
    service,
    sessionState,
    setPendingOperator,
    setSelectedIndex,
    syncPromptTextFromInput: actions.syncPromptTextFromInput,
    vimEnabled,
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
            if (picker) {
              actions.selectPickerOption(selectedIndex)
              return
            }

            actions.submitComposer()
          }}
        />
        <StatusBar onTodosClick={dialogs.openTodoOverlay} />
        {picker && !isDialogOpen ? (
          <CompletionOverlay
            title={picker.title}
            options={picker.options}
            selectedIndex={selectedIndex}
            loading={picker.kind === "file" ? picker.loading : false}
            focused={isNormalInteractionMode}
            onFocusList={actions.focusCompletionList}
            onSelect={(index: number) => {
              setSelectedIndex(index)
              actions.selectPickerOption(index)
            }}
          />
        ) : null}
      </box>
      <Toaster {...toasterOptions} />
    </>
  )
}
