import { describe, expect, it } from "bun:test"
import type { SlashCommand } from "#sdk/types"
import {
  filterLocalSlashCommands,
  listSlashCommandSuggestions,
  parseLocalSlashCommand,
  resolveComposerSubmission,
  shouldSubmitSlashSuggestion,
} from "#commands/slash"

const SDK_COMMANDS: readonly SlashCommand[] = [
  {
    name: "clear-history",
    description: "Clear archived session history",
    argumentHint: "",
  },
  {
    name: "plan",
    description: "Create a step-by-step plan",
    argumentHint: "<task>",
  },
] as const

describe("slash commands", () => {
  it("parses canonical names and aliases", () => {
    expect(parseLocalSlashCommand("/q")).toEqual({ name: "q", args: [] })
    expect(parseLocalSlashCommand("/quit")).toEqual({ name: "q", args: [] })
    expect(parseLocalSlashCommand("/sessions")).toEqual({ name: "sessions", args: [] })
  })

  it("parses argument-bearing local commands", () => {
    expect(parseLocalSlashCommand("/model sonnet")).toEqual({
      name: "model",
      args: ["sonnet"],
    })
    expect(parseLocalSlashCommand("/theme tokyo-night")).toEqual({
      name: "theme",
      args: ["tokyo-night"],
    })
  })

  it("rejects non-slash input and unknown local slash commands", () => {
    expect(parseLocalSlashCommand("hello")).toBeNull()
    expect(parseLocalSlashCommand(":q")).toBeNull()
    expect(parseLocalSlashCommand("/plan")).toBeNull()
  })

  it("filters local commands by canonical names and aliases", () => {
    expect(filterLocalSlashCommands("cl").map((command) => command.name)).toEqual(["clear"])
    expect(filterLocalSlashCommands("quit").map((command) => command.name)).toEqual(["q"])
  })

  it("sorts merged slash suggestions alphabetically across sources", () => {
    const suggestions = listSlashCommandSuggestions("/cl", SDK_COMMANDS)

    expect(suggestions.map((suggestion) => `${suggestion.source}:${suggestion.name}`)).toEqual([
      "local:/clear",
      "sdk:/clear-history",
    ])
  })

  it("routes local slash commands locally and leaves unknown slash commands for the sdk", () => {
    expect(resolveComposerSubmission("/clear")).toEqual({
      kind: "local_command",
      command: { name: "clear", args: [] },
    })
    expect(resolveComposerSubmission("/plan")).toEqual({ kind: "sdk_prompt" })
    expect(resolveComposerSubmission("hello")).toEqual({ kind: "sdk_prompt" })
    expect(resolveComposerSubmission("   ")).toEqual({ kind: "empty" })
  })

  it("submits exact local matches only when the command takes no arguments", () => {
    const [quitSuggestion] = listSlashCommandSuggestions("/quit", SDK_COMMANDS)
    const [themeSuggestion] = listSlashCommandSuggestions("/theme", SDK_COMMANDS)

    expect(quitSuggestion).toBeDefined()
    expect(themeSuggestion).toBeDefined()
    expect(shouldSubmitSlashSuggestion("/quit", quitSuggestion!)).toBe(true)
    expect(shouldSubmitSlashSuggestion("/theme", themeSuggestion!)).toBe(false)
  })

  it("returns all commands when the query is just a bare slash", () => {
    const suggestions = listSlashCommandSuggestions("/", SDK_COMMANDS)
    // Should include all local + all SDK commands
    expect(suggestions.length).toBeGreaterThanOrEqual(9 + SDK_COMMANDS.length)
  })

  it("normalizes queries with leading whitespace for filtering", () => {
    // normalizeSlashQuery strips the leading "/" — the App layer trims leading
    // whitespace before passing the token. Verify the underlying filter still
    // works correctly for bare tokens.
    expect(filterLocalSlashCommands("").length).toBe(9) // all local commands
    expect(filterLocalSlashCommands("mo").map((c) => c.name)).toEqual(["model"])
    expect(filterLocalSlashCommands("ses").map((c) => c.name)).toEqual(["sessions"])
  })

  it("parses local slash commands with leading whitespace", () => {
    expect(parseLocalSlashCommand("   /clear")).toEqual({ name: "clear", args: [] })
    expect(parseLocalSlashCommand("  /model sonnet")).toEqual({ name: "model", args: ["sonnet"] })
  })

  it("filters slash suggestions by command prefix only", () => {
    const suggestions = listSlashCommandSuggestions("/p", SDK_COMMANDS)

    expect(suggestions.map((suggestion) => suggestion.name)).toEqual([
      "/perm",
      "/plan",
    ])
  })

  it("ignores descriptions and argument hints when matching sdk slash commands", () => {
    const commands: readonly SlashCommand[] = [
      {
        name: "review",
        description: "task runner",
        argumentHint: "task-id",
      },
    ]

    expect(listSlashCommandSuggestions("/ta", commands)).toEqual([])
  })

  it("keeps alias prefix matching for local commands", () => {
    expect(listSlashCommandSuggestions("/qui", SDK_COMMANDS).map((suggestion) => suggestion.name)).toEqual([
      "/q",
    ])
  })
})
