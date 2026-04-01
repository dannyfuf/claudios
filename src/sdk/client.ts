/**
 * SDK client wrapper.
 *
 * Thin adapter around the Claude Agent SDK. The rest of the app
 * interacts with the SDK only through this module.
 */

import {
  query as sdkQuery,
  getSessionInfo as sdkGetSessionInfo,
  listSessions as sdkListSessions,
  getSessionMessages as sdkGetSessionMessages,
  renameSession as sdkRenameSession,
} from "@anthropic-ai/claude-agent-sdk"

import type {
  AccountInfo,
  ModelInfo,
  Query,
  Options,
  SlashCommand,
  SDKUserMessage,
  SDKSessionInfo,
  PermissionMode,
} from "#sdk/types"
import type { AppConfig } from "#config/schema"

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type CreateQueryParams = {
  readonly prompt: string | AsyncIterable<SDKUserMessage>
  readonly options?: Partial<Options>
}

export type SupportedMetadata = {
  readonly commands: readonly SlashCommand[]
  readonly models: readonly ModelInfo[]
  readonly account: AccountInfo
}

/**
 * Build the SDK Options object from our AppConfig + per-query overrides.
 */
function buildOptions(
  config: AppConfig,
  overrides?: Partial<Options>,
): Options {
  const base: Record<string, unknown> = {
    includePartialMessages: true,
    settingSources: ["user", "project", "local"],
    permissionMode: config.defaultPermissionMode as PermissionMode,
    model: config.defaultModel,
  }
  if (config.claudePath !== "claude") {
    base["pathToClaudeCodeExecutable"] = config.claudePath
  }
  if (overrides) {
    Object.assign(base, overrides)
  }

  if (
    base["permissionMode"] === "bypassPermissions"
    || base["allowDangerouslySkipPermissions"] === true
  ) {
    base["allowDangerouslySkipPermissions"] = true
  }

  // The SDK Options type is large with many optional fields.
  // We construct a valid subset and cast.
  return base as unknown as Options
}

/**
 * Start a new query (conversation turn).
 */
export function createQuery(
  config: AppConfig,
  params: CreateQueryParams,
): Query {
  const options = buildOptions(config, params.options)
  return sdkQuery({ prompt: params.prompt, options })
}

export async function getQueryMetadata(
  query: Pick<Query, "initializationResult">,
): Promise<SupportedMetadata> {
  const initialization = await query.initializationResult()

  return {
    commands: initialization.commands,
    models: initialization.models,
    account: initialization.account,
  }
}

export async function loadSupportedMetadata(
  config: AppConfig,
): Promise<SupportedMetadata> {
  const query = createQuery(config, {
    prompt: "metadata preload",
    options: { maxTurns: 0 },
  })

  try {
    return await getQueryMetadata(query)
  } finally {
    query.close()
  }
}

/**
 * Resume an existing session.
 */
export function resumeSession(
  config: AppConfig,
  sessionId: string,
  prompt: AsyncIterable<SDKUserMessage>,
  overrides?: Partial<Options>,
): Query {
  const merged: Partial<Options> = { ...overrides, resume: sessionId }
  const options = buildOptions(config, merged)
  return sdkQuery({ prompt, options })
}

/**
 * List available sessions.
 */
export async function listSessions(
  limit = 50,
): Promise<readonly SDKSessionInfo[]> {
  return sdkListSessions({ limit })
}

export async function getSessionInfo(
  sessionId: string,
): Promise<SDKSessionInfo | undefined> {
  return sdkGetSessionInfo(sessionId)
}

/**
 * Get messages for a session (for history replay on resume).
 */
export async function getSessionMessages(
  sessionId: string,
  limit = 200,
): Promise<readonly unknown[]> {
  return sdkGetSessionMessages(sessionId, { limit })
}

/**
 * Rename a session.
 */
export async function renameSession(
  sessionId: string,
  title: string,
): Promise<void> {
  await sdkRenameSession(sessionId, title)
}

/**
 * Quick auth check: attempt to create a query with maxTurns=0.
 * Returns true if the SDK initializes without auth errors.
 */
export async function checkAuth(config: AppConfig): Promise<boolean> {
  let q: Query | null = null

  try {
    const options = buildOptions(config, { maxTurns: 0 })
    q = sdkQuery({ prompt: "test", options })
    // Drain the generator — with maxTurns=0 it should yield a result quickly
    for await (const msg of q) {
      if (msg.type === "result" && "subtype" in msg) {
        break
      }
      if (msg.type === "auth_status" && "error" in msg && msg.error) {
        return false
      }
    }
    return true
  } catch {
    return false
  } finally {
    q?.close()
  }
}
