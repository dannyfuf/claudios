export function getSlashPickerQuery(promptText: string): string | null {
  if (!promptText.startsWith("/")) {
    return null
  }

  return /^\/\S*$/.test(promptText) ? promptText : null
}
