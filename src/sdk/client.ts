/**
 * SDK client wrapper.
 *
 * Thin adapter around the Claude Agent SDK. The rest of the app
 * interacts with the SDK only through this module.
 */

import { existsSync } from "node:fs"

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
import { getErrorMessage } from "#shared/errors"

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

export type AuthCheckResult =
  | { readonly status: "ready" }
  | {
      readonly status: "failed"
      readonly failureKind: "auth" | "binary" | "initialization"
      readonly message: string
    }

type AuthCheckDependencies = {
  readonly createQuery: (params: {
    readonly prompt: string
    readonly options: Options
  }) => Query
  readonly resolveCommand: (command: string) => string | undefined
  readonly pathExists: (path: string) => boolean
}

const defaultAuthCheckDependencies: AuthCheckDependencies = {
  createQuery: ({ prompt, options }) => sdkQuery({ prompt, options }),
  resolveCommand: (command) => Bun.which(command) ?? undefined,
  pathExists: (path) => existsSync(path),
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
 * Returns a structured startup result so callers can surface the real failure.
 */
export async function checkAuth(
  config: AppConfig,
  dependencies: Partial<AuthCheckDependencies> = {},
): Promise<AuthCheckResult> {
  const authDependencies: AuthCheckDependencies = {
    ...defaultAuthCheckDependencies,
    ...dependencies,
  }
  const preflightFailure = preflightClaudeExecutable(config, authDependencies)
  if (preflightFailure) {
    return preflightFailure
  }

  let q: Query | null = null

  try {
    const options = buildOptions(config, { maxTurns: 0 })
    q = authDependencies.createQuery({ prompt: "test", options })

    for await (const message of q as AsyncIterable<unknown>) {
      if (isAuthStatusError(message)) {
        return {
          status: "failed",
          failureKind: "auth",
          message: "Claude Code authentication required.",
        }
      }

      if (isResultSuccessMessage(message)) {
        return { status: "ready" }
      }

      if (isResultErrorMessage(message)) {
        return {
          status: "failed",
          failureKind: "initialization",
          message: `Failed to initialize Claude Code: ${getResultErrorMessage(message)}`,
        }
      }
    }
    return {
      status: "failed",
      failureKind: "initialization",
      message: "Failed to initialize Claude Code: startup probe ended before Claude Code reported readiness.",
    }
  } catch (error) {
    return {
      status: "failed",
      failureKind: "initialization",
      message: `Failed to initialize Claude Code: ${getErrorMessage(error)}`,
    }
  } finally {
    q?.close()
  }
}

function preflightClaudeExecutable(
  config: AppConfig,
  dependencies: AuthCheckDependencies,
): Extract<AuthCheckResult, { readonly status: "failed" }> | null {
  if (config.claudePath === "claude") {
    if (dependencies.resolveCommand("claude")) {
      return null
    }

    return {
      status: "failed",
      failureKind: "binary",
      message: "Claude Code CLI could not be found on PATH.",
    }
  }

  if (isPathLike(config.claudePath)) {
    if (dependencies.pathExists(config.claudePath)) {
      return null
    }

    return {
      status: "failed",
      failureKind: "binary",
      message: `Configured Claude executable was not found at \`${config.claudePath}\`.`,
    }
  }

  if (dependencies.resolveCommand(config.claudePath)) {
    return null
  }

  return {
    status: "failed",
    failureKind: "binary",
    message: `Configured Claude executable \`${config.claudePath}\` could not be found on PATH.`,
  }
}

function isPathLike(value: string): boolean {
  return value.includes("/") || value.startsWith(".") || value.startsWith("~")
}

function isAuthStatusError(
  message: unknown,
): message is { readonly type: "auth_status"; readonly error: string } {
  return isRecord(message)
    && message["type"] === "auth_status"
    && typeof message["error"] === "string"
    && message["error"].length > 0
}

function isResultSuccessMessage(
  message: unknown,
): message is {
  readonly type: "result"
  readonly subtype: "success"
} {
  return isRecord(message)
    && message["type"] === "result"
    && message["subtype"] === "success"
}

function isResultErrorMessage(
  message: unknown,
): message is {
  readonly type: "result"
  readonly subtype:
    | "error_during_execution"
    | "error_max_turns"
    | "error_max_budget_usd"
    | "error_max_structured_output_retries"
  readonly errors?: readonly string[]
} {
  return isRecord(message)
    && message["type"] === "result"
    && (
      message["subtype"] === "error_during_execution"
      || message["subtype"] === "error_max_turns"
      || message["subtype"] === "error_max_budget_usd"
      || message["subtype"] === "error_max_structured_output_retries"
    )
}

function getResultErrorMessage(message: {
  readonly subtype: string
  readonly errors?: readonly string[]
}): string {
  const firstError = message.errors?.find((error) => error.length > 0)
  if (firstError) {
    return firstError
  }

  switch (message.subtype) {
    case "error_during_execution":
      return "execution failed during startup"
    case "error_max_turns":
      return "startup probe exceeded max turns"
    case "error_max_budget_usd":
      return "startup probe exceeded the configured budget"
    case "error_max_structured_output_retries":
      return "startup probe exhausted structured output retries"
    default:
      return `startup probe failed with ${message.subtype}`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
