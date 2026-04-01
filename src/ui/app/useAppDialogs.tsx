import { useCallback } from "react"
import { useDialog } from "@opentui-ui/dialog/react"
import type { AlertContext, PromptContext } from "@opentui-ui/dialog/react"
import { toast } from "@opentui-ui/toast/react"
import type { McpServerStatus } from "#sdk/types"
import { getErrorMessage } from "#shared/errors"
import type { SetModelResult } from "#ui/app/local-commands"
import { KeymapHelpContent } from "#ui/components/KeymapHelpOverlay"
import { McpOverlayContent } from "#ui/components/McpOverlay"
import { ModelPickerDialogContent } from "#ui/components/ModelPickerOverlay"
import { SessionPickerDialogContent } from "#ui/components/SessionPickerOverlay"
import { TodoOverlayContent } from "#ui/components/TodoOverlay"
import { useConversationSelector, useConversationService, useKeymap } from "#ui/hooks"

export type AppDialogs = {
  readonly applyModelChange: (nextModel: string) => Promise<SetModelResult>
  readonly openKeymapHelp: () => void
  readonly openSessionPicker: () => Promise<void>
  readonly openModelPicker: () => Promise<void>
  readonly openTodoOverlay: () => void
  readonly openMcpOverlay: (servers: readonly McpServerStatus[]) => void
}

export function useAppDialogs(): AppDialogs {
  const dialog = useDialog()
  const keymap = useKeymap()
  const service = useConversationService()
  const currentModel = useConversationSelector((state) => state.model)
  const todoTracker = useConversationSelector((state) => state.todoTracker)
  const vimEnabled = useConversationSelector((state) => state.vimEnabled)

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
    if (!vimEnabled) {
      service.setVimMode("insert")
    }

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

    if (!selectedSessionId) {
      return
    }

    try {
      await service.loadSession(selectedSessionId)
      service.setVimMode("insert")
    } catch (error) {
      toast.error(`Failed to resume session: ${getErrorMessage(error)}`)
    }
  }, [dialog, service, vimEnabled])

  const openModelPicker = useCallback(async () => {
    if (!vimEnabled) {
      service.setVimMode("insert")
    }

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

    if (!selectedModel) {
      return
    }

    const result = await applyModelChange(selectedModel)
    if (!result.ok) {
      toast.error(`Failed to set model: ${result.error}`)
    }
  }, [applyModelChange, currentModel, dialog, service, vimEnabled])

  const openTodoOverlay = useCallback(() => {
    dialog.closeAll()
    void dialog.alert({
      content: ({ dismiss, dialogId }: AlertContext) => (
        <TodoOverlayContent
          items={todoTracker?.items ?? []}
          dismiss={dismiss}
          dialogId={dialogId}
        />
      ),
      size: "large",
    })
  }, [dialog, todoTracker])

  const openMcpOverlay = useCallback(
    (servers: readonly McpServerStatus[]) => {
      dialog.closeAll()
      void dialog.alert({
        content: ({ dismiss, dialogId }: AlertContext) => (
          <McpOverlayContent
            servers={[...servers]}
            onReconnect={async (name) => {
              await service.reconnectMcpServer(name)
            }}
            onToggle={async (name, enabled) => {
              await service.toggleMcpServer(name, enabled)
            }}
            dismiss={dismiss}
            dialogId={dialogId}
          />
        ),
        size: "large",
      })
    },
    [dialog, service],
  )

  return {
    applyModelChange,
    openKeymapHelp,
    openSessionPicker,
    openModelPicker,
    openTodoOverlay,
    openMcpOverlay,
  }
}
