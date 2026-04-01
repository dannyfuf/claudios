import { describe, expect, it } from "bun:test"
import type { AppConfig } from "#config/schema"
import { checkAuth } from "#sdk/client"
import type { Query } from "#sdk/types"

const TEST_CONFIG: AppConfig = {
  theme: "dark",
  editor: "$EDITOR",
  defaultModel: "sonnet",
  defaultPermissionMode: "default",
  keybindings: {},
  diffMode: "unified",
  showThinking: true,
  claudePath: "claude",
  vimEnabled: false,
}

describe("checkAuth", () => {
  it("returns ready when the probe completes without auth errors", async () => {
    let closeCalls = 0

    const result = await checkAuth(TEST_CONFIG, {
      createQuery: () => createFakeQuery({
        messages: [{ type: "result", subtype: "success" }],
        onClose: () => {
          closeCalls += 1
        },
      }),
      resolveCommand: () => "/usr/local/bin/claude",
      pathExists: () => true,
    })

    expect(result).toEqual({ status: "ready" })
    expect(closeCalls).toBe(1)
  })

  it("returns auth_required when the SDK reports an auth error", async () => {
    const result = await checkAuth(TEST_CONFIG, {
      createQuery: () => createFakeQuery({
        messages: [
          {
            type: "auth_status",
            isAuthenticating: false,
            output: [],
            error: "authentication_failed",
          },
        ],
      }),
      resolveCommand: () => "/usr/local/bin/claude",
      pathExists: () => true,
    })

    expect(result).toEqual({
      status: "failed",
      failureKind: "auth",
      message: "Claude Code authentication required.",
    })
  })

  it("returns a binary failure when claudePath points to a missing executable", async () => {
    let createQueryCalls = 0

    const result = await checkAuth(
      {
        ...TEST_CONFIG,
        claudePath: "/tmp/missing-claude",
      },
      {
        createQuery: () => {
          createQueryCalls += 1
          return createFakeQuery()
        },
        resolveCommand: () => "/usr/local/bin/claude",
        pathExists: () => false,
      },
    )

    expect(result).toEqual({
      status: "failed",
      failureKind: "binary",
      message: "Configured Claude executable was not found at `/tmp/missing-claude`.",
    })
    expect(createQueryCalls).toBe(0)
  })

  it("returns a binary failure when claude is missing from PATH", async () => {
    let createQueryCalls = 0

    const result = await checkAuth(TEST_CONFIG, {
      createQuery: () => {
        createQueryCalls += 1
        return createFakeQuery()
      },
      resolveCommand: () => undefined,
      pathExists: () => true,
    })

    expect(result).toEqual({
      status: "failed",
      failureKind: "binary",
      message: "Claude Code CLI could not be found on PATH.",
    })
    expect(createQueryCalls).toBe(0)
  })

  it("returns an initialization failure when the probe ends with SDK result errors", async () => {
    const result = await checkAuth(TEST_CONFIG, {
      createQuery: () => createFakeQuery({
        messages: [
          {
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            errors: ["startup exploded"],
          },
        ],
      }),
      resolveCommand: () => "/usr/local/bin/claude",
      pathExists: () => true,
    })

    expect(result).toEqual({
      status: "failed",
      failureKind: "initialization",
      message: "Failed to initialize Claude Code: startup exploded",
    })
  })
})

function createFakeQuery(options?: {
  readonly messages?: readonly unknown[]
  readonly onClose?: () => void
}): Query {
  return {
    close() {
      options?.onClose?.()
    },
    async *[Symbol.asyncIterator]() {
      for (const message of options?.messages ?? []) {
        yield message
      }
    },
  } as unknown as Query
}
