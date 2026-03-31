/**
 * Configuration schema and loader.
 *
 * Config file lives at ~/.config/claudios/config.json.
 * Missing file -> defaults. Invalid file -> warn + defaults.
 */

import { z } from "zod"
import { join } from "node:path"
import { homedir } from "node:os"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { DEFAULT_THEME_NAME, THEME_NAMES } from "#ui/theme"

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ConfigSchema = z.object({
  theme: z.enum(THEME_NAMES).default(DEFAULT_THEME_NAME),
  editor: z.string().default("$EDITOR"),
  defaultModel: z.string().default("sonnet"),
  defaultPermissionMode: z
    .enum(["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"])
    .default("bypassPermissions"),
  keybindings: z.record(z.string(), z.string()).default({}),
  diffMode: z.enum(["unified", "split"]).default("unified"),
  showThinking: z.boolean().default(true),
  claudePath: z.string().default("claude"),
  vimEnabled: z.boolean().default(false),
})

export type AppConfig = z.infer<typeof ConfigSchema>

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: AppConfig = ConfigSchema.parse({})

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const CONFIG_DIR = join(homedir(), ".config", "claudios")
export const CONFIG_PATH = join(CONFIG_DIR, "config.json")

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export type ConfigLoadResult =
  | { readonly ok: true; readonly config: AppConfig }
  | { readonly ok: false; readonly config: AppConfig; readonly error: string }

export async function loadConfig(): Promise<ConfigLoadResult> {
  let raw: string
  try {
    raw = await readFile(CONFIG_PATH, "utf-8")
  } catch {
    // File doesn't exist — use defaults
    return { ok: true, config: DEFAULT_CONFIG }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      ok: false,
      config: DEFAULT_CONFIG,
      error: `Invalid JSON in ${CONFIG_PATH}`,
    }
  }

  const result = ConfigSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    return {
      ok: false,
      config: DEFAULT_CONFIG,
      error: `Invalid config in ${CONFIG_PATH}:\n${issues}`,
    }
  }

  return { ok: true, config: result.data }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8")
}
