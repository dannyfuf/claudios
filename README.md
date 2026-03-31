# claudios

> A power-user Terminal UI for Claude Code

[![Version](https://img.shields.io/github/package-json/v/dannyfuf/claudios?color=blue&label=version)](https://github.com/dannyfuf/claudios)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun-%23f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dannyfuf/claudios/pulls)

**claudios** is a keyboard-driven TUI (terminal user interface) that wraps [Claude Code](https://claude.ai/download) with a richer, more ergonomic interface. It adds optional vim keybindings, session management, syntax-highlighted diffs, multiple themes, slash commands, mouse-friendly pickers, and real-time token/cost tracking — all in your terminal.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Quick install (curl)](#quick-install-curl)
  - [Manual / from source](#manual--from-source)
- [First run](#first-run)
- [Usage](#usage)
- [Uninstalling](#uninstalling)
- [Slash commands](#slash-commands)
- [Keybindings](#keybindings)
- [Configuration](#configuration)
- [Development](#development)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- **4-zone layout** — header (model, session, tokens, cost), scrollable message area, prompt input, and status bar
- **Optional vim mode** — start in plain typing mode and toggle vim insert/normal behavior with `/vim`
- **Slash commands** — `/new`, `/sessions`, `/model`, `/theme`, `/diff`, `/thinking`, `/perm`, `/vim`, `/keys`, `/clear`, `/q`
- **Session management** — list, resume, and browse transcripts of past conversations
- **Multiple themes** — `dark` (default), `tokyo-night`, `nord`, `forest`
- **Syntax-highlighted diffs** — toggle between unified and split view
- **Chronological activity timeline** — see thinking, tool calls, and spawned sub-tasks in execution order
- **Token & cost tracking** — live usage stats in the header
- **External editor support** — open your `$EDITOR` to compose long prompts
- **Task list tracker** — live collapsed summary of Claude's current todos in the status bar; expandable overlay shows all tasks with their status
- **Configurable keybindings** — remap any action via `config.json`

---

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| macOS or Linux | macOS 12+ / Ubuntu 20.04+ / Debian 11+ / Arch | Windows not supported |
| [Bun](https://bun.sh) | ≥ 1.1.0 | JavaScript runtime & bundler |
| [Claude Code CLI](https://claude.ai/download) | latest | Required — claudios wraps it |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| True-color terminal | — | iTerm2, Ghostty, Kitty, WezTerm, Alacritty, etc. |

---

## Installation

### Quick install (curl)

```sh
curl -fsSL https://raw.githubusercontent.com/dannyfuf/claudios/main/install.sh | sh
```

The script will:
1. Detect your OS and architecture
2. Install [Bun](https://bun.sh) if missing
3. Warn if [Claude Code CLI](https://claude.ai/download) is not found
4. Clone the repo to `~/.local/share/claudios`
5. Build the project (`bun install && bun run build`)
6. Symlink the `claudios` binary to `~/.local/bin/claudios`
7. Add `~/.local/bin` to your `$PATH` if needed

> **Note:** The installer is idempotent — running it again will update an existing installation.
> You can also update an installed copy in place with `claudios --upgrade`.

You can customize the install location with environment variables:

```sh
CLAUDIOS_INSTALL_DIR=~/tools/claudios \
CLAUDIOS_BIN_DIR=~/bin \
  curl -fsSL https://raw.githubusercontent.com/dannyfuf/claudios/main/install.sh | sh
```

---

### Manual / from source

```sh
# 1. Clone the repository
git clone https://github.com/dannyfuf/claudios.git
cd claudios

# 2. Install dependencies
bun install

# 3. Build
bun run build

# 4. Link the binary globally
mkdir -p ~/.local/bin
ln -sf "$(pwd)/dist/index.js" ~/.local/bin/claudios

# 5. Make sure ~/.local/bin is in your PATH
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc  # or ~/.bashrc
source ~/.zshrc
```

---

## First run

```sh
# Set your Anthropic API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Add to your shell profile to persist it
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc

# Launch
claudios
```

> **Claude Code CLI must be installed and authenticated** before launching claudios.
> If you haven't done so: `claude auth login`

---

## Usage

```sh
# Launch TUI chat (default)
claudios

# Start in a specific working directory
claudios --cwd /path/to/project

# Override the default model
claudios --model opus

# Resume a previous session
claudios --resume <session-id>

# Override permission mode
claudios --permission-mode acceptEdits

# Session management (no TUI)
claudios sessions list
claudios sessions show <session-id>

# View the resolved configuration
claudios config

# Upgrade the installed checkout and rebuild it
claudios --upgrade

# Help & version
claudios --help
claudios --version
```

---

## Updating

```sh
claudios --upgrade
```

This pulls the latest changes into the repo backing the current `claudios` binary, reinstalls dependencies if needed, and rebuilds the app.

---

## Uninstalling

```sh
claudios --uninstall
```

This will show what will be removed and prompt for confirmation before deleting anything:

```
The following will be removed:
  ✓ CLI symlink (~/.local/bin/claudios)
  ✓ App files (~/.local/share/claudios)
  ✓ Config (~/.config/claudios)

Proceed with uninstall? [y/N]
```

You can also run it as a subcommand:

```sh
claudios uninstall
```

---

## Slash commands

Type `/` in the prompt to trigger a command. A completion overlay will appear as you type.

| Command | Description |
|---|---|
| `/new` | Start a new session |
| `/sessions` | Open the interactive session picker |
| `/model <name>` | Switch model (e.g. `/model opus`) |
| `/theme <name>` | Switch theme (e.g. `/theme tokyo-night`) |
| `/diff` | Toggle between unified and split diff view |
| `/thinking [on\|off\|toggle]` | Show or hide thinking rows |
| `/perm <mode>` | Change permission mode (e.g. `/perm acceptEdits`) |
| `/vim [on\|off\|toggle]` | Enable, disable, or toggle vim mode |
| `/keys` | Show the keybindings help overlay |
| `/clear` | Clear the message area |
| `/q` | Quit claudios |

---

## Keybindings

claudios starts in **plain** mode, so you can type immediately without entering vim first. Run `/vim` to enable vim mode at runtime. When vim mode is enabled, `Escape` enters normal mode and `i` returns to insert mode.

### Global (any mode)

| Key | Action |
|---|---|
| `Ctrl+C` | Quit |
| `Ctrl+N` | New session |
| `Ctrl+R` | Open session picker |
| `Ctrl+P` | Open model picker |
| `Ctrl+E` | Open `$EDITOR` to compose prompt |
| `Ctrl+L` | Clear message area |
| `Ctrl+T` | Toggle task list overlay |
| `Ctrl+D` | Scroll half page down |
| `Ctrl+U` | Scroll half page up |
| `Page Down` | Scroll page down |
| `Page Up` | Scroll page up |
| `Home` | Scroll to top |
| `End` | Scroll to bottom |

### Plain mode (default)

| Key | Action |
|---|---|
| `Enter` | Submit prompt |

### Vim insert mode

| Key | Action |
|---|---|
| `Enter` | Submit prompt |
| `Escape` | Enter normal mode |

### Vim normal mode

| Key | Action |
|---|---|
| `i` | Enter insert mode |
| `a` | Insert after cursor |
| `A` | Insert at end of line |
| `I` | Insert at start of line |
| `?` | Show keybindings help |

### Permission modal

| Key | Action |
|---|---|
| `Enter` / `y` | Allow tool use |
| `Escape` / `n` | Deny tool use |

### Customizing keybindings

Override any action in `~/.config/claudios/config.json`:

```json
{
  "keybindings": {
    "quit": "ctrl+q",
    "session.new": "ctrl+t",
    "editor.open": "ctrl+o"
  }
}
```

The key is the **action name** (right column above); the value is the new key combination.

---

## Configuration

Config file location: `~/.config/claudios/config.json`

If the file doesn't exist, all defaults apply. The file is created lazily — you only need to add the fields you want to override.

```json
{
  "theme": "dark",
  "editor": "$EDITOR",
  "defaultModel": "sonnet",
  "defaultPermissionMode": "bypassPermissions",
  "diffMode": "unified",
  "showThinking": true,
  "claudePath": "claude",
  "keybindings": {}
}
```

### Config reference

| Field | Type | Default | Description |
|---|---|---|---|
| `theme` | `string` | `"dark"` | UI color theme. One of: `dark`, `tokyo-night`, `nord`, `forest` |
| `editor` | `string` | `"$EDITOR"` | Editor command for `Ctrl+E`. Supports `$EDITOR` and `$VISUAL` variables |
| `defaultModel` | `string` | `"sonnet"` | Default Claude model. Any model name Claude Code accepts (e.g. `opus`, `haiku`) |
| `defaultPermissionMode` | `string` | `"bypassPermissions"` | Permission mode: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk` |
| `diffMode` | `string` | `"unified"` | Diff display style: `unified` or `split` |
| `showThinking` | `boolean` | `true` | Whether thinking rows are visible in the transcript by default |
| `claudePath` | `string` | `"claude"` | Path to the Claude Code CLI binary |
| `keybindings` | `object` | `{}` | Action → key overrides (see [Keybindings](#keybindings)) |

### View resolved config

```sh
claudios config
```

This prints the config path and all resolved values (including defaults).

---

## Development

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1.0
- [Claude Code CLI](https://claude.ai/download)

### Setup

```sh
git clone https://github.com/dannyfuf/claudios.git
cd claudios
bun install
```

### Scripts

```sh
# Run from source with hot reload
bun run dev

# Type-check (no emit)
bun run typecheck

# Run tests
bun test

# Production build
bun run build
```

### Project structure

```
claudios/
├── src/
│   ├── index.tsx                 # CLI entrypoint — arg parsing, startup, renderer mount
│   ├── commands/
│   │   ├── keymap.ts             # Keybinding registry and resolution
│   │   └── slash.ts              # Slash command parsing and dispatch
│   ├── config/
│   │   └── schema.ts             # Zod config schema, loader, defaults
│   ├── sdk/
│   │   ├── client.ts             # Claude Agent SDK adapter
│   │   └── types.ts              # Domain types wrapping SDK types
│   ├── state/
│   │   └── conversation-service.ts  # Core state machine (Effect-TS)
│   └── ui/
│       ├── App.tsx               # Root component (4-zone layout)
│       ├── components/           # Header, MessageArea, PromptInput, StatusBar, overlays
│       ├── hooks.tsx             # React contexts and custom hooks
│       ├── theme.ts              # Theme palettes and bridge helpers
│       └── vim.ts                # Vim mode key handling
├── dist/                         # Build output (git-ignored)
├── install.sh                    # One-line installer
├── package.json
└── tsconfig.json
```

### Architecture overview

- **State:** `ConversationService` (Effect-TS) owns all conversation state. React subscribes via a callback registry — no shared mutable state leaks into the UI layer.
- **SDK:** `#sdk/client.ts` adapts the `@anthropic-ai/claude-agent-sdk` — wraps session management, auth checks, and streaming query creation.
- **UI:** OpenTUI (`@opentui/react`) renders the terminal layout. Components are standard React; OpenTUI handles the TTY rendering backend.
- **Config:** Loaded once at startup via Zod schema. CLI flags override config values before they reach the service layer.

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository and create a feature branch:
   ```sh
   git checkout -b feat/my-feature
   ```

2. **Make your changes** following the project conventions:
   - TypeScript strict mode — no `any`, no implicit returns
   - Runtime validation with Zod for any external input
   - Effect-TS for async state — keep side effects in the service layer
   - Tests required for new features or bug fixes

3. **Validate before submitting:**
   ```sh
   bun run typecheck   # must pass with zero errors
   bun test            # all tests must be green
   bun run build       # build must succeed
   ```

4. **Open a pull request** against `main`. Describe what you changed and why.

### Reporting bugs

Please [open an issue](https://github.com/dannyfuf/claudios/issues) with:
- OS and terminal emulator
- Bun version (`bun --version`)
- Steps to reproduce
- Expected vs. actual behaviour

---

## Troubleshooting

| Symptom | Solution |
|---|---|
| `claudios: command not found` | Add `~/.local/bin` to `$PATH`: `export PATH="$HOME/.local/bin:$PATH"` |
| `Claude Code authentication required` after install | The installer writes `claudePath` to `~/.config/claudios/config.json`. If missing, run `which claude` and add `"claudePath": "/path/to/claude"` to that file |
| `Claude Code authentication required` (fresh setup) | Run `claude auth login`, then retry |
| `ANTHROPIC_API_KEY not set` | Export the key: `export ANTHROPIC_API_KEY="sk-ant-..."` |
| Claude Code CLI not found | Install from [claude.ai/download](https://claude.ai/download) |
| TUI renders incorrectly / garbled | Use a true-color terminal. Try setting `TERM=xterm-256color` |
| Bun version too old | Run `bun upgrade` |
| Config not loading | Run `claudios config` to see the resolved path and any parse errors |
| Build fails after update | Delete `dist/` and re-run `bun run build` |

---

## License

MIT — see [LICENSE](LICENSE).
