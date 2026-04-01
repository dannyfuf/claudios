import { listSlashCommandSuggestions, type SlashCommandSuggestion } from "#commands/slash"
import type { SlashCommand } from "#sdk/types"
import { getSlashPickerQuery } from "#ui/slash-picker"

export type FilePickerOption = {
  readonly name: string
  readonly description: string
  readonly value: string
}

export type Picker =
  | {
      readonly kind: "file"
      readonly title: string
      readonly loading: boolean
      readonly options: readonly FilePickerOption[]
    }
  | {
      readonly kind: "slash"
      readonly title: string
      readonly options: readonly SlashCommandSuggestion[]
    }

export function getPickerState(input: {
  readonly promptText: string
  readonly availableCommands: readonly SlashCommand[]
  readonly workspaceFiles: readonly string[]
  readonly workspaceFilesLoaded: boolean
}): Picker | null {
  const activeFileToken = getActiveFileToken(input.promptText)
  if (activeFileToken) {
    const query = activeFileToken.query.toLowerCase()
    const options = input.workspaceFiles
      .filter((filePath) => !query || filePath.toLowerCase().includes(query))
      .slice(0, 50)
      .map((filePath) => ({
        name: `@${filePath}`,
        description: filePath,
        value: replaceActiveFileToken(input.promptText, activeFileToken.startIndex, filePath),
      }))

    return !input.workspaceFilesLoaded || options.length > 0
      ? {
          kind: "file",
          title: "Files",
          loading: !input.workspaceFilesLoaded,
          options,
        }
      : null
  }

  const slashPickerQuery = getSlashPickerQuery(input.promptText)
  if (slashPickerQuery === null) {
    return null
  }

  const options = listSlashCommandSuggestions(slashPickerQuery, input.availableCommands)
  return options.length > 0
    ? {
        kind: "slash",
        title: "Slash Commands",
        options,
      }
    : null
}

export function getActiveFileToken(
  promptText: string,
): { readonly query: string; readonly startIndex: number } | null {
  const match = /(^|\s)@([^\s]*)$/.exec(promptText)
  if (!match) {
    return null
  }

  const query = match[2] ?? ""
  return {
    query,
    startIndex: promptText.length - query.length - 1,
  }
}

export function replaceActiveFileToken(
  promptText: string,
  startIndex: number,
  filePath: string,
): string {
  const before = promptText.slice(0, startIndex)
  return `${before}@${filePath} `
}
