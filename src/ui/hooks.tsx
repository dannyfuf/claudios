/**
 * React context and hooks for accessing the ConversationService.
 */

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { ConversationService } from "#state/conversation-service"
import type { ConversationState } from "#state/types"
import type { AppConfig } from "#config/schema"
import { Keymap } from "#commands/keymap"
import { getThemePalette } from "#ui/theme"

export type AppController = {
  readonly quit: () => Promise<void>
  readonly openEditor: (initialText: string) => Promise<string | null>
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const ConversationServiceContext = createContext<ConversationService | null>(null)
const ConfigContext = createContext<AppConfig | null>(null)
const KeymapContext = createContext<Keymap | null>(null)
const AppControllerContext = createContext<AppController | null>(null)

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export const ConversationServiceProvider = ConversationServiceContext.Provider
export const ConfigProvider = ConfigContext.Provider
export const KeymapProvider = KeymapContext.Provider
export const AppControllerProvider = AppControllerContext.Provider

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useConversationService(): ConversationService {
  const service = useContext(ConversationServiceContext)
  if (!service) {
    throw new Error("useConversationService must be used within ConversationServiceProvider")
  }
  return service
}

/**
 * Subscribe to ConversationState with React 18 useSyncExternalStore.
 * The component re-renders whenever the state changes.
 */
export function useConversationState(): ConversationState {
  const service = useConversationService()
  return useSyncExternalStore(
    (callback) => service.subscribe(callback),
    () => service.getState(),
  )
}

/**
 * Select a slice of ConversationState to minimize re-renders.
 */
export function useConversationSelector<T>(
  selector: (state: ConversationState) => T,
): T {
  const service = useConversationService()
  return useSyncExternalStore(
    (callback) => service.subscribe(callback),
    () => selector(service.getState()),
  )
}

export function useConfig(): AppConfig {
  const config = useContext(ConfigContext)
  if (!config) {
    throw new Error("useConfig must be used within ConfigProvider")
  }
  return config
}

export function useKeymap(): Keymap {
  const keymap = useContext(KeymapContext)
  if (!keymap) {
    throw new Error("useKeymap must be used within KeymapProvider")
  }
  return keymap
}

export function useAppController(): AppController {
  const controller = useContext(AppControllerContext)
  if (!controller) {
    throw new Error("useAppController must be used within AppControllerProvider")
  }
  return controller
}

export function useThemePalette() {
  const themeName = useConversationSelector((state) => state.themeName)
  return getThemePalette(themeName)
}

/**
 * Debounce a value by `delayMs`. Returns the latest value after the caller
 * stops updating it for the given duration. Useful for filtering lists while
 * the user is still typing.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setDebounced(value)
    }, delayMs)

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
    }
  }, [value, delayMs])

  return debounced
}
