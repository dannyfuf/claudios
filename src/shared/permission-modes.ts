export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
] as const

export type PermissionModeName = (typeof PERMISSION_MODES)[number]

export type StandardPermissionMode = Exclude<PermissionModeName, "plan">

export const STANDARD_PERMISSION_MODES = PERMISSION_MODES.filter(
  (mode): mode is StandardPermissionMode => mode !== "plan",
)

export function isPermissionModeName(value: string): value is PermissionModeName {
  return PERMISSION_MODES.some((mode) => mode === value)
}

export function isStandardPermissionMode(value: string): value is StandardPermissionMode {
  return STANDARD_PERMISSION_MODES.some((mode) => mode === value)
}
