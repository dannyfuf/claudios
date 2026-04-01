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
    expect(parseLocalSlashCommand("/thinking off")).toEqual({
      name: "thinking",
      args: ["off"],
    })
    expect(parseLocalSlashCommand("/vim on")).toEqual({
      name: "vim",
      args: ["on"],
    })
  })

  it("rejects non-slash input and unknown local slash commands", () => {
    expect(parseLocalSlashCommand("hello")).toBeNull()
    expect(parseLocalSlashCommand(":q")).toBeNull()
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

  it("includes hint field on sdk suggestions", () => {
    const suggestions = listSlashCommandSuggestions("/pl", SDK_COMMANDS)
    const sdkPlanSuggestion = suggestions.find((s) => s.name === "/plan" && s.source === "sdk")

    expect(sdkPlanSuggestion).toBeDefined()
    if (sdkPlanSuggestion?.source === "sdk") {
      expect(sdkPlanSuggestion.hint).toBe("<task>")
    }
  })

  it("sets hint to null when argumentHint is empty", () => {
    const suggestions = listSlashCommandSuggestions("/cl", SDK_COMMANDS)
    const clearHistorySuggestion = suggestions.find((s) => s.name === "/clear-history")

    expect(clearHistorySuggestion?.source).toBe("sdk")
    if (clearHistorySuggestion?.source === "sdk") {
      expect(clearHistorySuggestion.hint).toBeNull()
    }
  })

  it("appends trailing space to value only when hint is present", () => {
    const suggestions = listSlashCommandSuggestions("/", SDK_COMMANDS)
    const sdkPlanSuggestion = suggestions.find((s) => s.name === "/plan" && s.source === "sdk")
    const clearHistorySuggestion = suggestions.find((s) => s.name === "/clear-history")

    expect(sdkPlanSuggestion?.value).toBe("/plan ")
    expect(clearHistorySuggestion?.value).toBe("/clear-history")
  })

  it("includes /mcp as a local command in the picker", () => {
    const suggestions = listSlashCommandSuggestions("/mc", SDK_COMMANDS)
    const mcpSuggestion = suggestions.find((s) => s.name === "/mcp")
    expect(mcpSuggestion).toBeDefined()
    expect(mcpSuggestion?.source).toBe("local")
  })

  it("routes /mcp as a local command", () => {
    expect(resolveComposerSubmission("/mcp")).toEqual({
      kind: "local_command",
      command: { name: "mcp", args: [] },
    })
  })

  it("routes local slash commands locally and leaves unknown slash commands for the sdk", () => {
    expect(resolveComposerSubmission("/clear")).toEqual({
      kind: "local_command",
      command: { name: "clear", args: [] },
    })
    expect(resolveComposerSubmission("/plan")).toEqual({
      kind: "local_command",
      command: { name: "plan", args: [] },
    })
    expect(resolveComposerSubmission("hello")).toEqual({ kind: "sdk_prompt" })
    expect(resolveComposerSubmission("   ")).toEqual({ kind: "empty" })
  })

  it("submits exact local matches only when the command allows it", () => {
    const [quitSuggestion] = listSlashCommandSuggestions("/quit", SDK_COMMANDS)
    const [themeSuggestion] = listSlashCommandSuggestions("/theme", SDK_COMMANDS)
    const [vimSuggestion] = listSlashCommandSuggestions("/vim", SDK_COMMANDS)

    expect(quitSuggestion).toBeDefined()
    expect(themeSuggestion).toBeDefined()
    expect(vimSuggestion).toBeDefined()
    expect(shouldSubmitSlashSuggestion("/quit", quitSuggestion!)).toBe(true)
    expect(shouldSubmitSlashSuggestion("/theme", themeSuggestion!)).toBe(false)
    expect(shouldSubmitSlashSuggestion("/vim", vimSuggestion!)).toBe(true)
  })

  it("returns all commands when the query is just a bare slash", () => {
    const suggestions = listSlashCommandSuggestions("/", SDK_COMMANDS)
    // Should include all local + all SDK commands
    expect(suggestions.length).toBeGreaterThanOrEqual(11 + SDK_COMMANDS.length)
  })

  it("normalizes queries with leading whitespace for filtering", () => {
    // normalizeSlashQuery strips the leading "/" — the App layer trims leading
    // whitespace before passing the token. Verify the underlying filter still
    // works correctly for bare tokens.
    expect(filterLocalSlashCommands("").length).toBe(13) // all local commands
    expect(filterLocalSlashCommands("mo").map((c) => c.name)).toEqual(["model"])
    expect(filterLocalSlashCommands("ses").map((c) => c.name)).toEqual(["sessions"])
  })

  it("suggests and parses the thinking visibility command", () => {
    expect(filterLocalSlashCommands("thi").map((command) => command.name)).toEqual(["thinking"])
    expect(parseLocalSlashCommand("/thinking")).toEqual({ name: "thinking", args: [] })
    expect(parseLocalSlashCommand("/thinking on")).toEqual({ name: "thinking", args: ["on"] })
    expect(parseLocalSlashCommand("/thinking off")).toEqual({ name: "thinking", args: ["off"] })
  })

  it("suggests and parses the vim toggle command", () => {
    expect(filterLocalSlashCommands("vi").map((command) => command.name)).toEqual(["vim"])
    expect(parseLocalSlashCommand("/vim")).toEqual({ name: "vim", args: [] })
    expect(parseLocalSlashCommand("/vim off")).toEqual({ name: "vim", args: ["off"] })
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
