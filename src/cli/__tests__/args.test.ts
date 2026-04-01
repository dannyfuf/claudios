import { describe, expect, it } from "bun:test"
import { getHelpText, getVersionText, parseArgs, printHelp, printVersion } from "#cli/args"

describe("parseArgs", () => {
  it("parses chat flags without mounting command handlers", () => {
    expect(
      parseArgs([
        "bun",
        "src/index.tsx",
        "chat",
        "--resume",
        "session-1",
        "--model",
        "haiku",
        "--permission-mode",
        "plan",
        "--cwd",
        "/tmp/project",
      ]),
    ).toEqual({
      command: "chat",
      resume: "session-1",
      model: "haiku",
      permissionMode: "plan",
      cwd: "/tmp/project",
    })
  })

  it("parses non-chat commands directly", () => {
    expect(parseArgs(["bun", "src/index.tsx", "sessions", "list"])).toEqual({
      command: "sessions.list",
    })
    expect(parseArgs(["bun", "src/index.tsx", "sessions", "show", "session-9"])).toEqual({
      command: "sessions.show",
      sessionId: "session-9",
    })
    expect(parseArgs(["bun", "src/index.tsx", "config"])).toEqual({ command: "config" })
    expect(parseArgs(["bun", "src/index.tsx", "--upgrade"])).toEqual({ command: "upgrade" })
    expect(parseArgs(["bun", "src/index.tsx", "uninstall"])).toEqual({ command: "uninstall" })
  })
})

describe("CLI output", () => {
  it("returns stable help and version text", () => {
    expect(getHelpText()).toContain("claudios - A power-user TUI for Claude Code")
    expect(getHelpText()).toContain("sessions show <id>")
    expect(getVersionText()).toBe("claudios v0.1.0")
  })

  it("prints help and version through the provided writer", () => {
    const output: string[] = []
    const writer = {
      log: (value: string) => {
        output.push(value)
      },
    }

    printHelp(writer)
    printVersion(writer)

    expect(output).toEqual([getHelpText(), getVersionText()])
  })
})
