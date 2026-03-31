type AssistantSessionFragment = {
  readonly raw: Record<string, unknown>
  readonly message: Record<string, unknown>
  readonly assistantMessageId: string
}

const SESSION_FRAGMENT_COUNT_FIELD = "__claudiosFragmentCount"

export function coalesceSessionMessages(messages: readonly unknown[]): readonly unknown[] {
  const coalesced: unknown[] = []

  for (const message of messages) {
    const previous = coalesced.at(-1)

    if (previous && canMergeAssistantSessionFragments(previous, message)) {
      coalesced[coalesced.length - 1] = mergeAssistantSessionFragments(previous, message)
      continue
    }

    coalesced.push(message)
  }

  return coalesced
}

export function getSessionMessageFragmentCount(message: unknown): number {
  if (!isRecord(message)) {
    return 1
  }

  const fragmentCount = message[SESSION_FRAGMENT_COUNT_FIELD]
  return typeof fragmentCount === "number" && Number.isInteger(fragmentCount) && fragmentCount > 0
    ? fragmentCount
    : 1
}

function canMergeAssistantSessionFragments(left: unknown, right: unknown): boolean {
  const leftFragment = getAssistantSessionFragment(left)
  const rightFragment = getAssistantSessionFragment(right)

  return (
    leftFragment !== null
    && rightFragment !== null
    && leftFragment.assistantMessageId === rightFragment.assistantMessageId
  )
}

function mergeAssistantSessionFragments(left: unknown, right: unknown): unknown {
  const leftFragment = getAssistantSessionFragment(left)
  const rightFragment = getAssistantSessionFragment(right)

  if (leftFragment === null || rightFragment === null) {
    return right
  }

  const merged: Record<string, unknown> = {
    ...leftFragment.raw,
    ...rightFragment.raw,
    [SESSION_FRAGMENT_COUNT_FIELD]:
      getSessionMessageFragmentCount(leftFragment.raw) + getSessionMessageFragmentCount(rightFragment.raw),
    message: {
      ...leftFragment.message,
      ...rightFragment.message,
      content: mergeAssistantContent(leftFragment.message["content"], rightFragment.message["content"]),
    },
  }

  if (typeof leftFragment.raw["uuid"] === "string") {
    merged["uuid"] = leftFragment.raw["uuid"]
  }

  return merged
}

function mergeAssistantContent(left: unknown, right: unknown): unknown {
  const leftParts = getAssistantContentParts(left)
  const rightParts = getAssistantContentParts(right)

  if (leftParts.length === 0) {
    return right
  }

  if (rightParts.length === 0) {
    return left
  }

  const mergedParts = [...leftParts, ...rightParts]

  return mergedParts.length === 1 && typeof mergedParts[0] === "string"
    ? mergedParts[0]
    : mergedParts
}

function getAssistantContentParts(content: unknown): readonly unknown[] {
  if (typeof content === "string") {
    return content.length > 0 ? [content] : []
  }

  return Array.isArray(content) ? content : []
}

function getAssistantSessionFragment(value: unknown): AssistantSessionFragment | null {
  if (!isRecord(value) || value["type"] !== "assistant") {
    return null
  }

  const message = value["message"]
  if (!isRecord(message)) {
    return null
  }

  const assistantMessageId = message["id"]
  if (typeof assistantMessageId !== "string" || assistantMessageId.length === 0) {
    return null
  }

  return {
    raw: value,
    message,
    assistantMessageId,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
