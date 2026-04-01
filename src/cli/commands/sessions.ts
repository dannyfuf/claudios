import { getSessionInfo, getSessionMessages, listSessions } from "#sdk/client"
import { coalesceSessionMessages } from "#sdk/session-history"
import { sessionSummaryFromSDK } from "#sdk/types"

export async function runSessionsList(): Promise<void> {
  const sessions = await listSessions()
  for (const session of sessions.map(sessionSummaryFromSDK)) {
    console.log(`${session.id}  ${session.title}  ${session.lastModified.toLocaleString()}`)
  }
}

export async function runSessionsShow(sessionId: string | null): Promise<void> {
  if (!sessionId) {
    console.error("Error: session id required")
    process.exitCode = 1
    return
  }

  const info = await getSessionInfo(sessionId)
  if (!info) {
    console.error(`Error: session not found: ${sessionId}`)
    process.exitCode = 1
    return
  }

  const messages = coalesceSessionMessages(await getSessionMessages(sessionId))
  console.log(`Session: ${info.sessionId}`)
  console.log(`Title: ${info.customTitle ?? info.summary ?? "(untitled)"}`)
  console.log(`Last modified: ${new Date(info.lastModified).toLocaleString()}`)
  console.log("")

  for (const message of messages) {
    const raw = message as Record<string, unknown>
    const type = raw["type"] === "assistant" ? "Claude" : "You"
    const text = extractSessionText(raw["message"])
    console.log(`${type}: ${text}`)
    console.log("")
  }
}

function extractSessionText(message: unknown): string {
  if (!isRecord(message)) {
    return ""
  }

  const content = message["content"]

  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block
      }

      if (isRecord(block) && typeof block["text"] === "string") {
        return block["text"]
      }

      return ""
    })
    .join("")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
