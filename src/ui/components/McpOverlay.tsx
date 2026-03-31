/**
 * McpOverlayContent — content rendered inside a dialog.alert()
 * for listing and managing MCP servers.
 *
 * Level 1 — server list with status icons, scope, and tool count.
 * Level 2 — server detail view with tools and annotations.
 *
 * Keyboard actions from level 1:
 *   r        reconnect selected server
 *   d        disable selected server
 *   e        enable selected server
 *   Enter    open server detail
 *   Esc / q  close overlay
 *
 * Keyboard actions from level 2:
 *   Esc / q  return to server list
 */

import { useState } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { useDialogKeyboard } from "@opentui-ui/dialog/react"
import type { DialogId } from "@opentui-ui/dialog/react"
import type { McpServerStatus } from "#sdk/types"
import { useThemePalette } from "#ui/hooks"

type McpOverlayContentProps = {
  readonly servers: McpServerStatus[]
  readonly onReconnect: (serverName: string) => Promise<void>
  readonly onToggle: (serverName: string, enabled: boolean) => Promise<void>
  readonly dismiss: () => void
  readonly dialogId: DialogId
}

type OverlayState =
  | { readonly view: "list"; readonly selectedIndex: number }
  | { readonly view: "detail"; readonly server: McpServerStatus }

const STATUS_ICONS: Record<McpServerStatus["status"], { icon: string; color: string }> = {
  connected: { icon: "●", color: "green" },
  pending: { icon: "◌", color: "yellow" },
  "needs-auth": { icon: "◌", color: "yellow" },
  failed: { icon: "✗", color: "red" },
  disabled: { icon: "-", color: "gray" },
}

export function McpOverlayContent(props: McpOverlayContentProps) {
  const { servers, onReconnect, onToggle, dismiss, dialogId } = props
  const theme = useThemePalette()
  const { height } = useTerminalDimensions()
  const panelHeight = Math.max(12, Math.min(height - 8, 28))

  const [state, setState] = useState<OverlayState>({ view: "list", selectedIndex: 0 })

  useDialogKeyboard((key) => {
    if (state.view === "detail") {
      if (key.name === "escape" || key.sequence === "q") {
        setState({ view: "list", selectedIndex: 0 })
      }
      return
    }

    // list view
    const { selectedIndex } = state

    if (key.name === "escape" || key.sequence === "q") {
      dismiss()
      return
    }

    if (key.name === "up" || key.sequence === "k") {
      setState({ view: "list", selectedIndex: Math.max(0, selectedIndex - 1) })
      return
    }

    if (key.name === "down" || key.sequence === "j") {
      setState({ view: "list", selectedIndex: Math.min(servers.length - 1, selectedIndex + 1) })
      return
    }

    if (key.name === "return") {
      const server = servers[selectedIndex]
      if (server) {
        setState({ view: "detail", server })
      }
      return
    }

    if (key.sequence === "r") {
      const server = servers[selectedIndex]
      if (server) {
        void onReconnect(server.name)
      }
      return
    }

    if (key.sequence === "d") {
      const server = servers[selectedIndex]
      if (server) {
        void onToggle(server.name, false)
      }
      return
    }

    if (key.sequence === "e") {
      const server = servers[selectedIndex]
      if (server) {
        void onToggle(server.name, true)
      }
      return
    }
  }, dialogId)

  if (state.view === "detail") {
    return (
      <McpDetailView
        server={state.server}
        panelHeight={panelHeight}
        theme={theme}
      />
    )
  }

  return (
    <McpListView
      servers={servers}
      selectedIndex={state.selectedIndex}
      panelHeight={panelHeight}
      theme={theme}
    />
  )
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

type ThemePalette = ReturnType<typeof useThemePalette>

function McpListView(props: {
  readonly servers: McpServerStatus[]
  readonly selectedIndex: number
  readonly panelHeight: number
  readonly theme: ThemePalette
}) {
  const { servers, selectedIndex, panelHeight, theme } = props

  return (
    <box flexDirection="column" width="100%" height={panelHeight}>
      <box paddingBottom={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text>
            <span fg={theme.text}>
              <strong>mcp servers</strong>
            </span>
          </text>
          <text>
            <span fg={theme.mutedText}>{servers.length}</span>
          </text>
        </box>
        <text>
          <span fg={theme.mutedText}>r reconnect  d disable  e enable  Enter details  Esc close</span>
        </text>
      </box>

      {servers.length === 0 ? (
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text>
            <span fg={theme.mutedText}>No MCP servers configured.</span>
          </text>
        </box>
      ) : (
        <scrollbox flexGrow={1}>
          {servers.map((server, index) => {
            const isSelected = index === selectedIndex
            const { icon, color } = STATUS_ICONS[server.status]
            const toolCount = server.tools?.length ?? 0
            const scope = server.scope ? `[${server.scope}]` : ""
            const errorText = server.status === "failed" && server.error ? `  ${server.error}` : ""

            return (
              <box
                key={server.name}
                flexDirection="row"
                gap={1}
                {...(isSelected ? { backgroundColor: theme.selection } : {})}
              >
                <box minWidth={2} maxWidth={2}>
                  <text>
                    <span fg={color}>{icon}</span>
                  </text>
                </box>
                <box minWidth={20} maxWidth={20}>
                  <text>
                    <span fg={isSelected ? theme.selectionText : theme.text}>{server.name}</span>
                  </text>
                </box>
                <box minWidth={12} maxWidth={12}>
                  <text>
                    <span fg={isSelected ? theme.selectionText : theme.mutedText}>{server.status}</span>
                  </text>
                </box>
                <box minWidth={12} maxWidth={12}>
                  <text>
                    <span fg={isSelected ? theme.selectionText : theme.mutedText}>{scope}</span>
                  </text>
                </box>
                <box flexGrow={1} minWidth={0}>
                  <text>
                    <span fg={isSelected ? theme.selectionText : theme.mutedText}>
                      {errorText || (toolCount > 0 ? `${toolCount} tools` : "")}
                    </span>
                  </text>
                </box>
              </box>
            )
          })}
        </scrollbox>
      )}
    </box>
  )
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function McpDetailView(props: {
  readonly server: McpServerStatus
  readonly panelHeight: number
  readonly theme: ThemePalette
}) {
  const { server, panelHeight, theme } = props
  const { icon, color } = STATUS_ICONS[server.status]
  const tools = server.tools ?? []
  const configType = server.config?.type ?? "unknown"
  const serverVersion = server.serverInfo?.version ? `  v${server.serverInfo.version}` : ""

  return (
    <box flexDirection="column" width="100%" height={panelHeight}>
      <box paddingBottom={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text>
            <span fg={color}>{icon}</span>
          </text>
          <text>
            <span fg={theme.text}>
              <strong>{server.name}</strong>
            </span>
          </text>
          <text>
            <span fg={theme.mutedText}>{configType}{serverVersion}</span>
          </text>
        </box>
        <text>
          <span fg={theme.mutedText}>Esc back</span>
        </text>
      </box>

      {server.error ? (
        <box paddingBottom={1}>
          <text>
            <span fg={theme.error}>{server.error}</span>
          </text>
        </box>
      ) : null}

      {tools.length === 0 ? (
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text>
            <span fg={theme.mutedText}>No tools exposed by this server.</span>
          </text>
        </box>
      ) : (
        <scrollbox flexGrow={1}>
          {tools.map((tool) => {
            const badges: string[] = []
            if (tool.annotations?.readOnly) badges.push("[readOnly]")
            if (tool.annotations?.destructive) badges.push("[destructive]")
            if (tool.annotations?.openWorld) badges.push("[openWorld]")
            const badgeText = badges.join(" ")

            return (
              <box key={tool.name} flexDirection="row" gap={1} marginBottom={1}>
                <box minWidth={28} maxWidth={28}>
                  <text>
                    <span fg={theme.text}>{tool.name}</span>
                  </text>
                </box>
                <box flexGrow={1} minWidth={0}>
                  <text>
                    <span fg={theme.mutedText}>{tool.description ?? ""}</span>
                  </text>
                </box>
                {badgeText ? (
                  <text>
                    <span fg={theme.warning}>{badgeText}</span>
                  </text>
                ) : null}
              </box>
            )
          })}
        </scrollbox>
      )}
    </box>
  )
}
