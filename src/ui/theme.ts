export type ThemePalette = {
  readonly shell: string
  readonly chrome: string
  readonly surface: string
  readonly surfaceAlt: string
  readonly surfaceElevated: string
  readonly assistantSurface: string
  readonly userSurface: string
  readonly toolSurface: string
  readonly text: string
  readonly mutedText: string
  readonly primary: string
  readonly primaryMuted: string
  readonly success: string
  readonly warning: string
  readonly error: string
  readonly borderSubtle: string
  readonly borderStrong: string
  readonly focus: string
  readonly overlay: string
  readonly selection: string
  readonly selectionText: string
}

export const THEME_NAMES = ["dark", "tokyo-night", "nord", "forest"] as const

export type ThemeName = (typeof THEME_NAMES)[number]

export const DEFAULT_THEME_NAME: ThemeName = "dark"

export const THEMES: Record<ThemeName, ThemePalette> = {
  "dark": {
    shell: "#09090b",
    chrome: "#0f0f12",
    surface: "#18181b",
    surfaceAlt: "#1c1c20",
    surfaceElevated: "#27272a",
    assistantSurface: "#141418",
    userSurface: "#18181b",
    toolSurface: "#18181b",
    text: "#fafafa",
    mutedText: "#a1a1aa",
    primary: "#e4e4e7",
    primaryMuted: "#27272a",
    success: "#4ade80",
    warning: "#f59e0b",
    error: "#f87171",
    borderSubtle: "#27272a",
    borderStrong: "#3f3f46",
    focus: "#d4d4d8",
    overlay: "rgba(0, 0, 0, 0.80)",
    selection: "#27272a",
    selectionText: "#fafafa",
  },
  "tokyo-night": {
    shell: "#0f1117",
    chrome: "#151926",
    surface: "#1a1b26",
    surfaceAlt: "#16161e",
    surfaceElevated: "#202335",
    assistantSurface: "#21263a",
    userSurface: "#1d2233",
    toolSurface: "#171b29",
    text: "#c0caf5",
    mutedText: "#7a85b0",
    primary: "#7aa2f7",
    primaryMuted: "#25304b",
    success: "#9ece6a",
    warning: "#e0af68",
    error: "#f7768e",
    borderSubtle: "#2d3248",
    borderStrong: "#565f89",
    focus: "#7aa2f7",
    overlay: "rgba(0, 0, 0, 0.66)",
    selection: "#24283b",
    selectionText: "#c0caf5",
  },
  nord: {
    shell: "#2b313c",
    chrome: "#333b49",
    surface: "#3b4252",
    surfaceAlt: "#434c5e",
    surfaceElevated: "#4a5568",
    assistantSurface: "#40495b",
    userSurface: "#465064",
    toolSurface: "#3f4758",
    text: "#eceff4",
    mutedText: "#a7b4c7",
    primary: "#88c0d0",
    primaryMuted: "#365361",
    success: "#a3be8c",
    warning: "#ebcb8b",
    error: "#bf616a",
    borderSubtle: "#556072",
    borderStrong: "#6a7488",
    focus: "#88c0d0",
    overlay: "rgba(34, 41, 51, 0.78)",
    selection: "#4c566a",
    selectionText: "#eceff4",
  },
  forest: {
    shell: "#0f1512",
    chrome: "#152019",
    surface: "#18221c",
    surfaceAlt: "#111913",
    surfaceElevated: "#223127",
    assistantSurface: "#1d2b22",
    userSurface: "#213128",
    toolSurface: "#172219",
    text: "#d7e4d1",
    mutedText: "#88a08c",
    primary: "#72c28b",
    primaryMuted: "#274534",
    success: "#86d19a",
    warning: "#d8bf72",
    error: "#d26b6b",
    borderSubtle: "#31473a",
    borderStrong: "#446050",
    focus: "#72c28b",
    overlay: "rgba(5, 10, 7, 0.76)",
    selection: "#243329",
    selectionText: "#d7e4d1",
  },
}

export function isThemeName(value: string): value is ThemeName {
  return THEME_NAMES.some((themeName) => themeName === value)
}

export function getThemePalette(themeName: string): ThemePalette {
  return isThemeName(themeName) ? THEMES[themeName] : THEMES[DEFAULT_THEME_NAME]
}

// ---------------------------------------------------------------------------
// Theme bridge — map ThemePalette to @opentui-ui provider props
// ---------------------------------------------------------------------------

import type { DialogContainerOptions } from "@opentui-ui/dialog/react"
import type { ToasterOptions } from "@opentui-ui/toast"

/**
 * Map the app's ThemePalette to DialogProvider container options.
 * Called once per theme change (memoised in the component tree).
 */
export function createDialogTheme(palette: ThemePalette): Partial<DialogContainerOptions> {
  return {
    size: "medium",
    dialogOptions: {
      style: {
        backgroundColor: palette.surfaceElevated,
        borderColor: palette.borderStrong,
        borderStyle: "rounded",
        border: true,
        paddingX: 2,
        paddingY: 1,
      },
    },
    backdropColor: "#000000",
    backdropOpacity: 0.4,
    closeOnEscape: true,
  }
}

/**
 * Map the app's ThemePalette to Toaster component options.
 * Called once per theme change (memoised in the component tree).
 */
export function createToasterOptions(palette: ThemePalette): Partial<ToasterOptions> {
  return {
    position: "bottom-right",
    maxWidth: 52,
    stackingMode: "stack",
    visibleToasts: 3,
    offset: { top: 1, right: 2, bottom: 2, left: 2 },
    toastOptions: {
      style: {
        backgroundColor: palette.surfaceElevated,
        foregroundColor: palette.text,
        borderColor: palette.borderSubtle,
        borderStyle: "rounded",
        mutedColor: palette.mutedText,
        paddingX: 1,
        paddingY: 0,
      },
      success: { style: { borderColor: palette.success } },
      error: { style: { borderColor: palette.error }, duration: 6000 },
      warning: { style: { borderColor: palette.warning } },
      info: { style: { borderColor: palette.primary } },
      loading: { style: { borderColor: palette.mutedText } },
    },
  }
}
