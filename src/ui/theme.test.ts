import { describe, expect, it } from "bun:test"
import {
  DEFAULT_THEME_NAME,
  THEME_NAMES,
  THEMES,
  createDialogTheme,
  createToasterOptions,
  getThemePalette,
  isThemeName,
} from "#ui/theme"

describe("theme resolution", () => {
  it("resolves every declared theme name", () => {
    for (const themeName of THEME_NAMES) {
      const palette = getThemePalette(themeName)
      expect(palette).toBe(THEMES[themeName])
      expect(palette.shell.length).toBeGreaterThan(0)
      expect(palette.surfaceElevated.length).toBeGreaterThan(0)
      expect(palette.selectionText.length).toBeGreaterThan(0)
    }
  })

  it("falls back to the default palette for unknown theme names", () => {
    expect(getThemePalette("missing-theme")).toBe(THEMES[DEFAULT_THEME_NAME])
  })

  it("narrows theme names without casts", () => {
    expect(isThemeName("dark")).toBe(true)
    expect(isThemeName("tokyo-night")).toBe(true)
    expect(isThemeName("unknown")).toBe(false)
  })
})

describe("createDialogTheme", () => {
  it("produces valid dialog options for every theme", () => {
    for (const themeName of THEME_NAMES) {
      const palette = THEMES[themeName]
      const dialogTheme = createDialogTheme(palette)

      expect(dialogTheme.size).toBe("medium")
      expect(dialogTheme.closeOnEscape).toBe(true)
      expect(dialogTheme.backdropColor).toBe("#000000")
      expect(typeof dialogTheme.backdropOpacity).toBe("number")

      const style = dialogTheme.dialogOptions?.style
      expect(style).toBeDefined()
      expect(style?.backgroundColor).toBe(palette.surfaceElevated)
      expect(style?.borderColor).toBe(palette.borderStrong)
      expect(style?.border).toBe(true)
    }
  })

  it("contains no hardcoded palette colors in the structure", () => {
    const palette = THEMES["dark"]
    const dialogTheme = createDialogTheme(palette)
    const style = dialogTheme.dialogOptions?.style

    // Panel colors come from the palette, not hardcoded
    expect(style?.backgroundColor).toBe(palette.surfaceElevated)
    expect(style?.borderColor).toBe(palette.borderStrong)
  })
})

describe("createToasterOptions", () => {
  it("produces valid toaster options for every theme", () => {
    for (const themeName of THEME_NAMES) {
      const palette = THEMES[themeName]
      const options = createToasterOptions(palette)

      expect(options.position).toBe("bottom-right")
      expect(options.stackingMode).toBe("stack")
      expect(options.visibleToasts).toBe(3)
      expect(typeof options.maxWidth).toBe("number")

      const baseStyle = options.toastOptions?.style
      expect(baseStyle).toBeDefined()
      expect(baseStyle?.backgroundColor).toBe(palette.surfaceElevated)
      expect(baseStyle?.foregroundColor).toBe(palette.text)

      expect(options.toastOptions?.success?.style?.borderColor).toBe(palette.success)
      expect(options.toastOptions?.error?.style?.borderColor).toBe(palette.error)
      expect(options.toastOptions?.warning?.style?.borderColor).toBe(palette.warning)
      expect(options.toastOptions?.info?.style?.borderColor).toBe(palette.primary)
      expect(options.toastOptions?.loading?.style?.borderColor).toBe(palette.mutedText)
    }
  })

  it("uses a longer duration for error toasts", () => {
    const palette = THEMES["dark"]
    const options = createToasterOptions(palette)
    expect(options.toastOptions?.error?.duration).toBe(6000)
  })
})
