import type { SlashCommand as SDKSlashCommand } from "#sdk/types"

type LocalSlashCommandEntry = {
  readonly name: string
  readonly aliases: readonly string[]
  readonly description: string
  readonly insertText: string
  readonly acceptsArguments: boolean
  readonly submitOnExactMatch?: boolean
}

type ParseVimCommandModeResult =
  | { readonly ok: true; readonly mode: VimCommandMode }
  | { readonly ok: false; readonly error: string }

export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
] as const

export type PermissionModeName = (typeof PERMISSION_MODES)[number]
export type VimCommandMode = "toggle" | "on" | "off"

export const LOCAL_SLASH_COMMANDS = [
  {
    name: "q",
    aliases: ["quit"],
    description: "Exit the TUI",
    insertText: "/q",
    acceptsArguments: false,
    submitOnExactMatch: true,
  },
  {
    name: "new",
    aliases: [],
    description: "Start a new session",
    insertText: "/new",
    acceptsArguments: false,
    submitOnExactMatch: true,
  },
  {
    name: "sessions",
    aliases: [],
    description: "Open the session picker",
    insertText: "/sessions",
    acceptsArguments: false,
    submitOnExactMatch: true,
  },
  {
    name: "clear",
    aliases: [],
    description: "Clear the message area",
    insertText: "/clear",
    acceptsArguments: false,
    submitOnExactMatch: true,
  },
  {
    name: "model",
    aliases: [],
    description: "Switch model",
    insertText: "/model ",
    acceptsArguments: true,
    submitOnExactMatch: false,
  },
  {
    name: "perm",
    aliases: [],
    description: "Change permission mode",
    insertText: "/perm ",
    acceptsArguments: true,
    submitOnExactMatch: false,
  },
  {
    name: "theme",
    aliases: [],
    description: "Switch color theme",
    insertText: "/theme ",
    acceptsArguments: true,
    submitOnExactMatch: false,
  },
  {
    name: "diff",
    aliases: [],
    description: "Toggle unified/split diff view",
    insertText: "/diff",
    acceptsArguments: false,
    submitOnExactMatch: true,
  },
  {
    name: "thinking",
    aliases: [],
    description: "Show or hide thinking rows",
    insertText: "/thinking ",
    acceptsArguments: true,
    submitOnExactMatch: false,
  },
  {
    name: "vim",
    aliases: [],
    description: "Enable, disable, or toggle vim mode",
    insertText: "/vim",
    acceptsArguments: true,
    submitOnExactMatch: true,
  },
  {
    name: "keys",
    aliases: ["help"],
    description: "Show keybinding reference",
    insertText: "/keys",
    acceptsArguments: false,
    submitOnExactMatch: true,
  },
  {
    name: "mcp",
    aliases: [],
    description: "List and manage MCP servers",
    insertText: "/mcp",
    acceptsArguments: false,
    submitOnExactMatch: true,
  },
] as const satisfies readonly LocalSlashCommandEntry[]

export type LocalSlashCommandDefinition = (typeof LOCAL_SLASH_COMMANDS)[number]
export type LocalSlashCommandName = LocalSlashCommandDefinition["name"]

export type ParsedLocalSlashCommand = {
  readonly name: LocalSlashCommandName
  readonly args: readonly string[]
}

export type SlashCommandSuggestion =
  | {
      readonly name: string
      readonly description: string
      readonly value: string
      readonly source: "local"
      readonly commandName: LocalSlashCommandName
      readonly submitOnExactMatch: boolean
    }
  | {
      readonly name: string
      readonly description: string
      readonly hint: string | null
      readonly value: string
      readonly source: "sdk"
      readonly submitOnExactMatch: false
    }

export type ComposerSubmission =
  | { readonly kind: "empty" }
  | { readonly kind: "local_command"; readonly command: ParsedLocalSlashCommand }
  | { readonly kind: "sdk_prompt" }

export function isPermissionModeName(value: string): value is PermissionModeName {
  return PERMISSION_MODES.some((mode) => mode === value)
}

export function parseVimCommandMode(args: readonly string[]): ParseVimCommandModeResult {
  if (args.length === 0) {
    return { ok: true, mode: "toggle" }
  }

  if (args.length > 1) {
    return { ok: false, error: "Invalid vim mode: expected on, off, or toggle" }
  }

  const value = args[0]?.trim().toLowerCase()
  if (value === "on" || value === "off" || value === "toggle") {
    return { ok: true, mode: value }
  }

  return { ok: false, error: "Invalid vim mode: expected on, off, or toggle" }
}

export function filterLocalSlashCommands(query: string): readonly LocalSlashCommandDefinition[] {
  return rankPrefixMatches(LOCAL_SLASH_COMMANDS, normalizeSlashQuery(query), (command) => ({
    prefix: [command.name, ...command.aliases],
  }))
}

// Commands known to the CLI but not always returned in SDK metadata
const STATIC_NATIVE_COMMANDS: readonly SDKSlashCommand[] = []

export function listSlashCommandSuggestions(
  query: string,
  sdkCommands: readonly SDKSlashCommand[],
): readonly SlashCommandSuggestion[] {
  const normalizedQuery = normalizeSlashQuery(query)
  const localSuggestions = filterLocalSlashCommands(normalizedQuery).map((command) => ({
    name: command.insertText.trim(),
    description: formatLocalCommandDescription(command),
    value: command.insertText,
    source: "local" as const,
    commandName: command.name,
    submitOnExactMatch: command.submitOnExactMatch,
  }))

  const sdkNames = new Set(sdkCommands.map((c) => c.name))
  const supplemental = STATIC_NATIVE_COMMANDS.filter((c) => !sdkNames.has(c.name))
  const allSdkCommands = [...sdkCommands, ...supplemental]

  const sdkSuggestions = rankPrefixMatches(allSdkCommands, normalizedQuery, (command) => ({
    prefix: [command.name],
  })).map((command) => {
    const hint = command.argumentHint || null
    return {
      name: `/${command.name}`,
      description: `Claude command: ${command.description}${hint ? `  ${hint}` : ""}`,
      hint,
      value: `/${command.name}${hint ? " " : ""}`,
      source: "sdk" as const,
      submitOnExactMatch: false as const,
    }
  })

  return [...localSuggestions, ...sdkSuggestions].sort((left, right) =>
    left.name.localeCompare(right.name),
  )
}

export function parseLocalSlashCommand(input: string): ParsedLocalSlashCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith("/")) return null

  const withoutPrefix = trimmed.slice(1).trim()
  if (!withoutPrefix) return null

  const [rawName, ...args] = withoutPrefix.split(/\s+/)
  if (!rawName) return null

  const name = normalizeLocalSlashCommandName(rawName)
  if (!name) return null

  return { name, args }
}

export function normalizeLocalSlashCommandName(
  rawName: string,
): LocalSlashCommandName | null {
  const normalized = rawName.trim().toLowerCase()
  if (!normalized) return null

  for (const command of LOCAL_SLASH_COMMANDS) {
    if (command.name === normalized) return command.name
    if (command.aliases.some((alias) => alias === normalized)) return command.name
  }

  return null
}

export function resolveComposerSubmission(input: string): ComposerSubmission {
  const trimmed = input.trim()
  if (!trimmed) {
    return { kind: "empty" }
  }

  const command = parseLocalSlashCommand(trimmed)
  if (command) {
    return { kind: "local_command", command }
  }

  return { kind: "sdk_prompt" }
}

export function shouldSubmitSlashSuggestion(
  input: string,
  suggestion: SlashCommandSuggestion,
): boolean {
  if (suggestion.source !== "local" || !suggestion.submitOnExactMatch) {
    return false
  }

  const command = parseLocalSlashCommand(input)
  return command !== null && command.args.length === 0 && command.name === suggestion.commandName
}

function formatLocalCommandDescription(command: LocalSlashCommandDefinition): string {
  if (command.aliases.length === 0) {
    return `App command: ${command.description}`
  }

  const aliases = command.aliases.map((alias) => `/${alias}`).join(", ")
  return `App command: ${command.description} (${aliases})`
}

function normalizeSlashQuery(query: string): string {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return ""
  return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed
}

function rankPrefixMatches<TItem>(
  items: readonly TItem[],
  query: string,
  getMatchFields: (item: TItem) => {
    readonly prefix: readonly string[]
  },
): TItem[] {
  if (!query) {
    return [...items]
  }

  const prefixMatches: TItem[] = []

  for (const item of items) {
    const { prefix } = getMatchFields(item)
    if (prefix.some((value) => value.toLowerCase().startsWith(query))) {
      prefixMatches.push(item)
    }
  }

  return prefixMatches
}
