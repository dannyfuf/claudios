type LogWriter = {
  readonly log: (value: string) => void
}

export type CLIArgs =
  | {
      command: "chat"
      resume: string | null
      model: string | null
      permissionMode: string | null
      cwd: string | null
    }
  | { command: "help" }
  | { command: "version" }
  | { command: "upgrade" }
  | { command: "uninstall" }
  | { command: "sessions.list" }
  | { command: "sessions.show"; sessionId: string | null }
  | { command: "config" }

const HELP_TEXT = `
claudios - A power-user TUI for Claude Code

Usage:
  claudios [chat] [flags]

Commands:
  chat                   Launch the TUI chat (default)
  sessions list          List saved sessions
  sessions show <id>     Show a session transcript
  config                 Show resolved config
  upgrade                Pull latest repo changes and rebuild claudios
  uninstall              Remove claudios from your system
  help                   Show this help

Flags:
  --resume <sessionId>   Resume a session
  --model <model>        Override default model
  --permission-mode <m>  Set permission mode
  --cwd <path>           Set working directory
  --upgrade              Pull latest repo changes and rebuild claudios
  --uninstall            Remove claudios from your system
  -h, --help             Show help
  -v, --version          Show version
`

const VERSION_TEXT = "claudios v0.1.0"

export function parseArgs(argv: readonly string[]): CLIArgs {
  const args = argv.slice(2)
  const result: Extract<CLIArgs, { command: "chat" }> = {
    command: "chat",
    resume: null,
    model: null,
    permissionMode: null,
    cwd: null,
  }

  if (args[0] === "sessions" && args[1] === "list") {
    return { command: "sessions.list" }
  }

  if (args[0] === "sessions" && args[1] === "show") {
    return { command: "sessions.show", sessionId: args[2] ?? null }
  }

  if (args[0] === "config") {
    return { command: "config" }
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) {
      continue
    }

    switch (arg) {
      case "chat":
        result.command = "chat"
        break
      case "--help":
      case "-h":
      case "help":
        return { command: "help" }
      case "--version":
      case "-v":
      case "version":
        return { command: "version" }
      case "--upgrade":
      case "upgrade":
        return { command: "upgrade" }
      case "--uninstall":
      case "uninstall":
        return { command: "uninstall" }
      case "--resume":
        result.resume = args[index + 1] ?? null
        index += 1
        break
      case "--model":
        result.model = args[index + 1] ?? null
        index += 1
        break
      case "--permission-mode":
        result.permissionMode = args[index + 1] ?? null
        index += 1
        break
      case "--cwd":
        result.cwd = args[index + 1] ?? null
        index += 1
        break
      default:
        break
    }
  }

  return result
}

export function getHelpText(): string {
  return HELP_TEXT
}

export function printHelp(writer: LogWriter = console): void {
  writer.log(getHelpText())
}

export function getVersionText(): string {
  return VERSION_TEXT
}

export function printVersion(writer: LogWriter = console): void {
  writer.log(getVersionText())
}
