import { createElement, useEffect, useRef } from "react"
import type { ConfirmContext } from "@opentui-ui/dialog/react"
import { useDialog } from "@opentui-ui/dialog/react"
import { PermissionDialogContent } from "#ui/components/PermissionModal"
import { useConversationService, useConversationSelector } from "#ui/hooks"

export function usePermissionDialog(): void {
  const dialog = useDialog()
  const service = useConversationService()
  const sessionState = useConversationSelector((state) => state.sessionState)
  const permissionRequestRef = useRef<string | null>(null)

  useEffect(() => {
    if (sessionState.status !== "awaiting_permission") {
      permissionRequestRef.current = null
      return
    }

    const { toolName, toolInput } = sessionState.request
    const requestKey = `${sessionState.request.kind}:${toolName}:${JSON.stringify(toolInput)}`
    if (permissionRequestRef.current === requestKey) {
      return
    }

    permissionRequestRef.current = requestKey

    // Permission prompts should replace any existing overlay instead of
    // depending on another hook's effect ordering.
    dialog.closeAll()

    void dialog.confirm({
      content: ({ resolve, dismiss, dialogId }: ConfirmContext) =>
        createElement(PermissionDialogContent, {
          kind: sessionState.request.kind,
          toolName,
          toolInput,
          ...(sessionState.request.title ? { title: sessionState.request.title } : {}),
          ...(sessionState.request.description
            ? { description: sessionState.request.description }
            : {}),
          resolve,
          dismiss,
          dialogId,
        }),
      size: "medium",
      fallback: false,
      closeOnEscape: true,
    }).then((allowed) => {
      service.resolvePermission(allowed)
    })
  }, [dialog, service, sessionState])
}
