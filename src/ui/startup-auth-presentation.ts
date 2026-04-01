import type { StartupState } from "#state/types"

type FailedAuthState = Extract<StartupState["auth"], { readonly status: "failed" }>

export type StartupAuthPresentation = {
  readonly badge: string
  readonly title: string
  readonly rows: readonly string[]
  readonly statusCompact: string
  readonly statusFull: string
  readonly placeholderCompact: string
  readonly placeholderFull: string
}

export function getStartupAuthPresentation(auth: FailedAuthState): StartupAuthPresentation {
  switch (auth.kind) {
    case "auth":
      return {
        badge: "auth required",
        title: "Claude Code needs authentication.",
        rows: ["Run `claude auth login`, then restart claudios."],
        statusCompact: "auth req",
        statusFull: "authentication required",
        placeholderCompact: "Claude auth required",
        placeholderFull: "Claude auth required before sending messages",
      }
    case "binary":
      return {
        badge: "claude unavailable",
        title: "Claude Code executable unavailable.",
        rows: [
          "Check `claudios config` and `which claude`.",
          "Rerun the installer or update `claudePath`, then restart claudios.",
        ],
        statusCompact: "claude err",
        statusFull: "claude unavailable",
        placeholderCompact: "Claude unavailable",
        placeholderFull: "Claude executable unavailable",
      }
    case "initialization":
      return {
        badge: "startup failed",
        title: "Claude Code failed to initialize.",
        rows: ["Restart claudios after checking the error above."],
        statusCompact: "init fail",
        statusFull: "startup failed",
        placeholderCompact: "Startup failed",
        placeholderFull: "Claude startup failed",
      }
  }
}
