import { useCallback, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react"
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { toast } from "@opentui-ui/toast/react"
import { resolveComposerSubmission, shouldSubmitSlashSuggestion } from "#commands/slash"
import type { ParsedLocalSlashCommand } from "#commands/slash"
import { getErrorMessage } from "#shared/errors"
import type { ConversationService } from "#state/conversation-service"
import { runLocalSlashCommand as executeLocalSlashCommand } from "#ui/app/local-commands"
import type { Picker } from "#ui/app/picker-state"
import type { AppDialogs } from "#ui/app/useAppDialogs"
import type { AppController } from "#ui/hooks"
import type { VimPendingOperator } from "#ui/vim"

type UseAppActionsInput = {
  readonly appController: AppController
  readonly dialogs: AppDialogs
  readonly availableModelValues: readonly string[]
  readonly canSubmitPrompt: boolean
  readonly inputRef: RefObject<InputRenderable | null>
  readonly messageAreaRef: RefObject<ScrollBoxRenderable | null>
  readonly pendingEscapeInterruptRef: MutableRefObject<number | null>
  readonly picker: Picker | null
  readonly promptText: string
  readonly service: ConversationService
  readonly setPendingOperator: Dispatch<SetStateAction<VimPendingOperator>>
  readonly vimEnabled: boolean
}

export function useAppActions(input: UseAppActionsInput) {
  const focusCompletionList = useCallback(() => {
    if (input.vimEnabled) {
      input.service.setVimMode("normal")
    }
  }, [input.service, input.vimEnabled])

  const clearPendingEscapeInterrupt = useCallback(() => {
    input.pendingEscapeInterruptRef.current = null
  }, [input.pendingEscapeInterruptRef])

  const interruptRunningRequest = useCallback(() => {
    void input.service.interrupt().catch((error) => {
      toast.error(`Failed to cancel request: ${getErrorMessage(error)}`)
    })
  }, [input.service])

  const runLocalSlashCommand = useCallback(
    async (command: ParsedLocalSlashCommand) => {
      await executeLocalSlashCommand(command, {
        quit: input.appController.quit,
        newSession: () => input.service.newSession(),
        openSessionPicker: input.dialogs.openSessionPicker,
        clearMessages: () => input.service.clearMessages(),
        availableModelValues: input.availableModelValues,
        setModel: input.dialogs.applyModelChange,
        setPermissionMode: (mode) => input.service.setPermissionMode(mode),
        togglePlanMode: () => input.service.togglePlanMode(),
        appendSystemMessage: (text) => input.service.appendSystemMessage(text),
        setTheme: (themeName) => input.service.setTheme(themeName),
        toggleDiffMode: () => input.service.toggleDiffMode(),
        toggleThinkingVisibility: () => input.service.toggleThinkingVisibility(),
        setShowThinking: (showThinking) => input.service.setShowThinking(showThinking),
        setVimEnabled: (enabled) => input.service.setVimEnabled(enabled),
        vimEnabled: input.vimEnabled,
        openKeymapHelp: input.dialogs.openKeymapHelp,
        loadMcpServers: () => input.service.getMcpServerStatus(),
        openMcpOverlay: input.dialogs.openMcpOverlay,
        notify: toast,
      })
    },
    [input.appController, input.availableModelValues, input.dialogs, input.service, input.vimEnabled],
  )

  const submitComposer = useCallback(() => {
    if (!input.canSubmitPrompt) {
      return
    }

    const submission = resolveComposerSubmission(input.promptText)
    if (submission.kind === "empty") {
      return
    }

    if (submission.kind === "local_command") {
      input.service.setPromptText("")
      void runLocalSlashCommand(submission.command).catch((error) => {
        toast.error(getErrorMessage(error))
      })
      return
    }

    void input.service.submitCurrentPrompt()
  }, [input.canSubmitPrompt, input.promptText, input.service, runLocalSlashCommand])

  const selectPickerOption = useCallback(
    (index: number) => {
      if (!input.picker) {
        return
      }

      if (input.picker.kind === "slash") {
        const option = input.picker.options[index]
        if (!option) {
          return
        }

        if (shouldSubmitSlashSuggestion(input.promptText, option)) {
          submitComposer()
          return
        }

        input.service.setPromptText(option.value)
      } else {
        const option = input.picker.options[index]
        if (!option) {
          return
        }

        input.service.setPromptText(option.value)
      }

      if (input.vimEnabled) {
        input.service.setVimMode("insert")
      }
    },
    [input.picker, input.promptText, input.service, input.vimEnabled, submitComposer],
  )

  const syncPromptTextFromInput = useCallback(() => {
    const currentInput = input.inputRef.current
    if (!currentInput) {
      return
    }

    input.service.setPromptText(currentInput.value)
  }, [input.inputRef, input.service])

  const handleAction = useCallback(
    (action: string) => {
      switch (action) {
        case "quit":
          void input.appController.quit()
          break
        case "session.new":
          void input.service.newSession()
          break
        case "session.openPicker":
          void input.dialogs.openSessionPicker()
          break
        case "model.openPicker":
          void input.dialogs.openModelPicker()
          break
        case "messages.clear":
          input.service.clearMessages()
          break
        case "scroll.halfPageDown":
          input.messageAreaRef.current?.scrollBy(0.5, "viewport")
          break
        case "scroll.halfPageUp":
          input.messageAreaRef.current?.scrollBy(-0.5, "viewport")
          break
        case "scroll.pageDown":
          input.messageAreaRef.current?.scrollBy(1, "viewport")
          break
        case "scroll.pageUp":
          input.messageAreaRef.current?.scrollBy(-1, "viewport")
          break
        case "scroll.top":
          input.messageAreaRef.current?.scrollTo(0)
          break
        case "scroll.bottom":
          if (input.messageAreaRef.current) {
            input.messageAreaRef.current.scrollTo(input.messageAreaRef.current.scrollHeight)
          }
          break
        case "editor.open":
          void input.appController.openEditor(input.promptText)
            .then((value) => {
              if (value !== null) {
                input.service.setPromptText(value)
                input.service.setVimMode("insert")
              }
            })
            .catch((error) => {
              toast.error(`Editor failed: ${getErrorMessage(error)}`)
            })
          break
        case "mode.normal":
          input.setPendingOperator(null)
          input.service.setVimMode("normal")
          break
        case "mode.insert":
          input.setPendingOperator(null)
          input.service.setVimMode("insert")
          break
        case "mode.insertAfter":
          input.setPendingOperator(null)
          input.inputRef.current?.moveCursorRight()
          input.service.setVimMode("insert")
          break
        case "mode.insertEnd":
          input.setPendingOperator(null)
          input.inputRef.current?.gotoLineEnd()
          input.service.setVimMode("insert")
          break
        case "mode.insertStart":
          input.setPendingOperator(null)
          input.inputRef.current?.gotoLineHome()
          input.service.setVimMode("insert")
          break
        case "prompt.submit":
          submitComposer()
          break
        case "keys.help":
          input.dialogs.openKeymapHelp()
          break
        case "todos.toggle":
          input.dialogs.openTodoOverlay()
          break
        case "plan.toggle":
          void input.service.togglePlanMode().catch((error) => {
            toast.error(`Failed to toggle plan mode: ${getErrorMessage(error)}`)
          })
          break
        case "permission.allow":
          input.service.resolvePermission(true)
          break
        case "permission.deny":
          input.service.resolvePermission(false)
          break
        default:
          break
      }
    },
    [input, submitComposer],
  )

  return {
    clearPendingEscapeInterrupt,
    focusCompletionList,
    handleAction,
    interruptRunningRequest,
    selectPickerOption,
    submitComposer,
    syncPromptTextFromInput,
  }
}
