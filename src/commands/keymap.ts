/**
 * Central keymap registry.
 *
 * Defines all keybindings as a declarative map. Keybindings can be
 * overridden via the config file's `keybindings` field.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KeyContext = "global" | "modal" | "select"
export type InteractionModeContext = "plain" | "insert" | "normal"

export type KeymapEntry = {
  readonly key: string
  readonly mode?: InteractionModeContext
  readonly context: KeyContext
  readonly action: string
  readonly description: string
}

export function normalizeKeyBinding(key: string): string {
  // Kitty alternate keys report Ctrl+Shift+/ as the unshifted base key.
  return key === "ctrl+?" ? "ctrl+/" : key
}

// ---------------------------------------------------------------------------
// Default bindings
// ---------------------------------------------------------------------------

const defaultBindings: readonly KeymapEntry[] = [
  // Global
  { key: "ctrl+c", context: "global", action: "quit", description: "Quit the TUI" },
  { key: "ctrl+n", context: "global", action: "session.new", description: "Start a new session" },
  { key: "ctrl+r", context: "global", action: "session.openPicker", description: "Open the session manager" },
  { key: "ctrl+p", context: "global", action: "model.openPicker", description: "Open the model picker" },
  { key: "ctrl+e", context: "global", action: "editor.open", description: "Open $EDITOR for prompt" },
  { key: "ctrl+l", context: "global", action: "messages.clear", description: "Clear message area" },

  { key: "ctrl+t", context: "global", action: "todos.toggle", description: "Toggle task list" },

  // Scroll (global, work regardless of input focus)
  { key: "ctrl+d", context: "global", action: "scroll.halfPageDown", description: "Scroll half page down" },
  { key: "ctrl+u", context: "global", action: "scroll.halfPageUp", description: "Scroll half page up" },
  { key: "pagedown", context: "global", action: "scroll.pageDown", description: "Scroll page down" },
  { key: "pageup", context: "global", action: "scroll.pageUp", description: "Scroll page up" },
  { key: "home", context: "global", action: "scroll.top", description: "Scroll to top" },
  { key: "end", context: "global", action: "scroll.bottom", description: "Scroll to bottom" },

  // Input vim modes
  { key: "escape", context: "global", mode: "insert", action: "mode.normal", description: "Enter normal mode" },
  { key: "i", context: "global", mode: "normal", action: "mode.insert", description: "Enter insert mode" },
  { key: "a", context: "global", mode: "normal", action: "mode.insertAfter", description: "Insert after cursor" },
  { key: "A", context: "global", mode: "normal", action: "mode.insertEnd", description: "Insert at end of line" },
  { key: "I", context: "global", mode: "normal", action: "mode.insertStart", description: "Insert at start of line" },
  { key: "?", context: "global", mode: "normal", action: "keys.help", description: "Show keybinding help" },
  { key: "ctrl+/", context: "global", mode: "plain", action: "keys.help", description: "Show keybinding help" },

  // Submit
  { key: "enter", context: "global", mode: "plain", action: "prompt.submit", description: "Submit prompt" },
  { key: "enter", context: "global", mode: "insert", action: "prompt.submit", description: "Submit prompt" },

  // Permission modal
  { key: "enter", context: "modal", action: "permission.allow", description: "Allow tool use" },
  { key: "y", context: "modal", action: "permission.allow", description: "Allow tool use" },
  { key: "escape", context: "modal", action: "permission.deny", description: "Deny tool use" },
  { key: "n", context: "modal", action: "permission.deny", description: "Deny tool use" },
] as const

// ---------------------------------------------------------------------------
// Keymap class
// ---------------------------------------------------------------------------

export class Keymap {
  private readonly entries: KeymapEntry[]

  constructor(overrides?: Record<string, string>) {
    // Start with defaults
    this.entries = defaultBindings.map((entry) => ({
      ...entry,
      key: normalizeKeyBinding(entry.key),
    }))

    // Apply overrides: the keys in overrides map action -> key
    if (overrides) {
      for (const [action, key] of Object.entries(overrides)) {
        const idx = this.entries.findIndex((e) => e.action === action)
        if (idx !== -1) {
          const existing = this.entries[idx]!
          this.entries[idx] = { ...existing, key: normalizeKeyBinding(key) }
        }
      }
    }
  }

  /**
   * Find the action for a given key event in a given context + vim mode.
   */
  resolve(
    key: string,
    context: KeyContext,
    interactionMode: InteractionModeContext,
  ): string | null {
    const normalizedKey = normalizeKeyBinding(key)

    // Modal context takes priority
    if (context === "modal") {
      const modalEntry = this.entries.find(
        (e) => e.key === normalizedKey && e.context === "modal",
      )
      if (modalEntry) return modalEntry.action
    }

    // Check mode-specific bindings first
    const modeEntry = this.entries.find(
      (e) => e.key === normalizedKey && e.context === context && e.mode === interactionMode,
    )
    if (modeEntry) return modeEntry.action

    // Then mode-agnostic global bindings
    const globalEntry = this.entries.find(
      (e) => e.key === normalizedKey && e.context === context && e.mode === undefined,
    )
    if (globalEntry) return globalEntry.action

    return null
  }

  /**
   * Get all entries (for displaying keybinding help).
   */
  allBindings(): readonly KeymapEntry[] {
    return this.entries
  }
}
