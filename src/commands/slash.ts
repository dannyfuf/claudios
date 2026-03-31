import type { SlashCommand as SDKSlashCommand } from "#sdk/types"

type LocalSlashCommandEntry = {
  readonly name: string
  readonly aliases: readonly string[]
  readonly description: string
  readonly insertText: string
  readonly acceptsArguments: boolean
}

export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
] as const

export type PermissionModeName = (typeof PERMISSION_MODES)[number]

export const LOCAL_SLASH_COMMANDS = [
  {
    name: "q",
    aliases: ["quit"],
    description: "Exit the TUI",
    insertText: "/q",
    acceptsArguments: false,
  },
  {
    name: "new",
    aliases: [],
    description: "Start a new session",
    insertText: "/new",
    acceptsArguments: false,
  },
  {
    name: "sessions",
    aliases: [],
    description: "Open the session picker",
    insertText: "/sessions",
    acceptsArguments: false,
  },
  {
    name: "clear",
    aliases: [],
    description: "Clear the message area",
    insertText: "/clear",
    acceptsArguments: false,
  },
  {
    name: "model",
    aliases: [],
    description: "Switch model",
    insertText: "/model ",
    acceptsArguments: true,
  },
  {
    name: "perm",
    aliases: [],
    description: "Change permission mode",
    insertText: "/perm ",
    acceptsArguments: true,
  },
  {
    name: "theme",
    aliases: [],
    description: "Switch color theme",
    insertText: "/theme ",
    acceptsArguments: true,
  },
  {
    name: "diff",
    aliases: [],
    description: "Toggle unified/split diff view",
    insertText: "/diff",
    acceptsArguments: false,
  },
  {
    name: "keys",
    aliases: [],
    description: "Show keybinding reference",
    insertText: "/keys",
    acceptsArguments: false,
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

export function filterLocalSlashCommands(query: string): readonly LocalSlashCommandDefinition[] {
  return rankPrefixMatches(LOCAL_SLASH_COMMANDS, normalizeSlashQuery(query), (command) => ({
    prefix: [command.name, ...command.aliases],
  }))
}

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
    submitOnExactMatch: !command.acceptsArguments,
  }))

  const sdkSuggestions = rankPrefixMatches(sdkCommands, normalizedQuery, (command) => ({
    prefix: [command.name],
  })).map((command) => ({
    name: `/${command.name}`,
    description: `Claude command: ${command.description}`,
    value: `/${command.name} `,
    source: "sdk" as const,
    submitOnExactMatch: false as const,
  }))

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
