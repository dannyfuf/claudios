import { getInteractionMode, type InteractionMode } from "#state/types"
import { useConversationSelector } from "#ui/hooks"

export type ModeMatcher = InteractionMode | readonly InteractionMode[]

export function useInteractionMode(): InteractionMode {
  return useConversationSelector(getInteractionMode)
}

export function matchesInteractionMode(
  current: InteractionMode,
  expected: ModeMatcher,
): boolean {
  return Array.isArray(expected) ? expected.includes(current) : current === expected
}
