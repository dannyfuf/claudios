# Implementation Plan: OSS README & Install Script
Generated: 2026-03-30

---

## Summary

**better-claude** is a power-user Terminal UI (TUI) for Claude Code, built with TypeScript/Bun/React and the Anthropic Claude Agent SDK. It currently has no README, no LICENSE, and no install script — making it effectively undiscoverable and unusable as an open-source project.

This plan covers authoring a production-quality OSS README and a curl-installable install script so that any developer can find, understand, install, and contribute to the project with zero prior context.

**In scope:** `README.md`, `install.sh`, minor `package.json` additions (bin field / version verification).
**Out of scope:** GitHub Actions CI, actual npm/homebrew publishing, website/docs site, changing application code.

---

## Prerequisites

### Environment
- **Runtime:** Bun ≥ 1.1.0 (`curl -fsSL https://bun.sh/install | bash`)
- **Node.js:** ≥ 18 (Bun bundles its own, but useful for contributors)
- **Git:** For cloning and contributing
- **Claude Code CLI:** Must be installed separately (the SDK wraps it)
- **ANTHROPIC_API_KEY:** Required at runtime

### Project Knowledge
- Config is loaded from `~/.config/better-claude/config.json`
- Build produces `dist/index.js` (Bun bundle target)
- Binary name is `better-claude` (or `bclaud` — decide in Task 1)
- TypeScript path aliases: `#sdk/*`, `#state/*`, `#ui/*`, `#commands/*`, `#config/*`
- Tests run via `bun test`; typecheck via `tsc --noEmit`

### Coding Standards
- TypeScript strict mode (`tsconfig.json`)
- Shell scripts: POSIX-compatible sh (not bash-only), `set -euo pipefail`
- Markdown: ATX headings (`##`), fenced code blocks with language tag
- No emojis in source files unless explicitly part of UI

---

## Task Breakdown

### Task 1 — Decide the Binary Name & Confirm Package.json `bin` Field
**Complexity:** Low
**Dependency:** None (do first)

**What to do:**
- Decide on a short, memorable binary name (suggestion: `bclaud` to avoid collision with Claude Code's own `claude` binary)
- Verify `package.json` has a `bin` field pointing at `dist/index.js`
- Confirm `dist/index.js` has a `#!/usr/bin/env bun` shebang on line 1 (required for global install)

**Files to touch:**
- `package.json` — add/verify `"bin": { "bclaud": "./dist/index.js" }`
- `src/index.tsx` — check shebang line

**Acceptance criteria:**
- `package.json` has `bin` key
- `dist/index.js` starts with `#!/usr/bin/env bun` after build

**Example `package.json` addition:**
```json
{
  "name": "better-claude",
  "version": "0.1.0",
  "bin": {
    "bclaud": "./dist/index.js"
  }
}
```

---

### Task 2 — Add a LICENSE File
**Complexity:** Low
**Dependency:** None

**What to do:**
- Choose a license (MIT recommended for maximum OSS adoption)
- Create `LICENSE` in the repo root

**Files to create:**
- `/LICENSE`

**Template (MIT):**
```
MIT License

Copyright (c) 2026 dannyfuf

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Acceptance criteria:** `LICENSE` file exists at repo root.

---

### Task 3 — Write the Install Script (`install.sh`)
**Complexity:** Medium
**Dependency:** Task 1 (binary name must be decided)

**What to do:**
Create a POSIX shell install script at `install.sh` that is safe to pipe from curl. It must:
1. Detect OS (macOS / Linux) and architecture (x86_64 / arm64)
2. Check for Bun, offer to install it if missing
3. Check for Claude Code CLI, warn if missing (can't auto-install)
4. Clone repo into `~/.local/share/better-claude` (or update if already present)
5. Run `bun install && bun run build` inside the cloned directory
6. Symlink `dist/index.js` (or the binary) into `~/.local/bin/bclaud`
7. Detect shell (`$SHELL`) and offer to add `~/.local/bin` to `PATH` if needed
8. Print a success message with first-run instructions

**Files to create:**
- `install.sh` at repo root

**Script structure:**
```sh
#!/usr/bin/env sh
set -euo pipefail

REPO="https://github.com/dannyfuf/claudios"
INSTALL_DIR="$HOME/.local/share/better-claude"
BIN_DIR="$HOME/.local/bin"
BINARY_NAME="bclaud"

# --- Helper functions ---
info()    { printf '\033[0;34m[better-claude]\033[0m %s\n' "$*"; }
success() { printf '\033[0;32m[better-claude]\033[0m %s\n' "$*"; }
warn()    { printf '\033[0;33m[better-claude]\033[0m %s\n' "$*"; }
error()   { printf '\033[0;31m[better-claude]\033[0m %s\n' "$*" >&2; exit 1; }

# --- Detect OS ---
detect_os() { ... }

# --- Check Bun ---
check_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    warn "Bun not found. Installing..."
    curl -fsSL https://bun.sh/install | sh
    export PATH="$HOME/.bun/bin:$PATH"
  fi
}

# --- Check Claude Code ---
check_claude_code() {
  if ! command -v claude >/dev/null 2>&1; then
    warn "Claude Code CLI not found. Install it from: https://claude.ai/download"
    warn "better-claude requires Claude Code to function."
  fi
}

# --- Clone or update ---
install_or_update() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing installation..."
    git -C "$INSTALL_DIR" pull --ff-only
  else
    info "Cloning repository..."
    git clone "$REPO" "$INSTALL_DIR"
  fi
}

# --- Build ---
build() {
  info "Installing dependencies and building..."
  cd "$INSTALL_DIR"
  bun install
  bun run build
}

# --- Link binary ---
link_binary() {
  mkdir -p "$BIN_DIR"
  ln -sf "$INSTALL_DIR/dist/index.js" "$BIN_DIR/$BINARY_NAME"
  chmod +x "$INSTALL_DIR/dist/index.js"
}

# --- PATH setup ---
setup_path() { ... }

# --- Main ---
main() {
  detect_os
  check_bun
  check_claude_code
  install_or_update
  build
  link_binary
  setup_path
  success "Installation complete! Run: $BINARY_NAME"
}

main "$@"
```

**Acceptance criteria:**
- `curl -fsSL https://raw.githubusercontent.com/dannyfuf/claudios/main/install.sh | sh` works on macOS arm64 and Linux x86_64
- Script is idempotent (re-running it updates the installation)
- Exits with error messages on missing git, bun install failure, or build failure
- Does NOT use bash-only features (`[[`, arrays, `local` in all positions)

---

### Task 4 — Write the README
**Complexity:** High
**Dependency:** Tasks 1, 2, 3 (binary name and license must be known)

**Files to create:**
- `README.md` at repo root

**Required sections (in order):**

#### 4a. Hero Section
- Project name: **better-claude**
- One-line tagline: *"A power-user TUI for Claude Code"*
- Badges (use shields.io):
  - `npm version` (or Bun equivalent)
  - `license: MIT`
  - `bun ≥ 1.1`
  - `TypeScript`
  - `PRs Welcome`
- A screenshot or asciicast GIF showing the TUI in action (placeholder until screenshot is captured)

#### 4b. Table of Contents
Link to all major sections.

#### 4c. Features
Document the key capabilities:
- 4-zone layout (header, messages, prompt, status bar)
- Vim mode (insert / normal)
- Slash commands: `/new`, `/sessions`, `/model`, `/theme`, `/diff`, `/perm`, `/keys`, `/clear`, `/q`
- Session management (resume, list, show transcript)
- Multiple themes
- Syntax-highlighted diffs (unified/split)
- Tool call display with spawned task tracking
- Token + cost tracking in header
- External editor support (`$EDITOR`)
- Configurable keybindings

#### 4d. Requirements
```
- macOS 12+ or Linux (Ubuntu 20.04+, Debian 11+, Arch)
- Bun ≥ 1.1.0
- Claude Code CLI (claude) — https://claude.ai/download
- ANTHROPIC_API_KEY environment variable
- A terminal with true color support (iTerm2, Ghostty, Kitty, WezTerm, Alacritty)
```

#### 4e. Installation (Quick — curl)
```sh
curl -fsSL https://raw.githubusercontent.com/dannyfuf/claudios/main/install.sh | sh
```
Then first run:
```sh
export ANTHROPIC_API_KEY="sk-ant-..."
bclaud
```

#### 4f. Installation (Manual / From Source)
```sh
# 1. Clone
git clone https://github.com/dannyfuf/claudios.git
cd claudios

# 2. Install dependencies
bun install

# 3. Build
bun run build

# 4. Link globally
ln -sf "$(pwd)/dist/index.js" ~/.local/bin/bclaud
chmod +x dist/index.js
```

#### 4g. Configuration
Explain `~/.config/better-claude/config.json` with a full example:
```json
{
  "theme": "dark",
  "editor": "nvim",
  "defaultModel": "sonnet",
  "defaultPermissionMode": "default",
  "diffMode": "unified",
  "claudePath": "/usr/local/bin/claude",
  "keybindings": {}
}
```
Document each field, valid values, and defaults (sourced from `src/config/schema.ts`).

#### 4h. Usage
```sh
# Start TUI chat
bclaud

# Start in a specific directory
bclaud --cwd /path/to/project

# Resume with a specific model
bclaud --model opus

# Session management
bclaud sessions list
bclaud sessions show <session-id>

# View resolved config
bclaud config
```

#### 4i. Slash Commands Reference (table)
| Command | Description |
|---|---|
| `/new` | Start a new session |
| `/sessions` | Open session picker |
| `/model <name>` | Switch model (sonnet, opus, haiku) |
| `/theme <name>` | Switch theme |
| `/diff` | Toggle unified/split diff view |
| `/perm <mode>` | Change permission mode |
| `/keys` | Show keybindings help |
| `/clear` | Clear message area |
| `/q` | Quit |

#### 4j. Keybindings
Document default keybindings (normal mode vs insert mode), and how to customize via config.

#### 4k. Development
```sh
# Run from source (watch mode)
bun run dev

# Type-check
bun run typecheck  # or: npx tsc --noEmit

# Run tests
bun test

# Build
bun run build
```

Project structure diagram (abbreviated tree).

#### 4l. Contributing
- Fork → branch → PR workflow
- Coding standards: TypeScript strict, no `any`, zod for runtime validation
- Tests required for new features
- Run typecheck + tests before submitting

#### 4m. Troubleshooting
| Symptom | Solution |
|---|---|
| `bclaud: command not found` | Add `~/.local/bin` to `$PATH` |
| `Error: Claude Code not found` | Install Claude Code CLI from https://claude.ai/download |
| `ANTHROPIC_API_KEY not set` | Export the env var in your shell profile |
| TUI renders incorrectly | Use a true-color terminal; set `TERM=xterm-256color` |
| Bun version mismatch | Run `bun upgrade` |

#### 4n. License
MIT — see `LICENSE`.

**Acceptance criteria:**
- README renders cleanly on GitHub (check with `gh repo view`)
- All code blocks have language tags
- Installation section works as a standalone guide (someone with no context can follow it)
- No broken internal links

---

### Task 5 — Validation & Smoke Test
**Complexity:** Low
**Dependency:** Tasks 3, 4

**What to do:**
1. Test the install script on a clean shell (new terminal, no `bclaud` in PATH)
2. Verify `curl -fsSL ... | sh` completes without error
3. Verify `bclaud --version` prints the version from `package.json`
4. Verify `bclaud --help` prints usage
5. Verify the README renders correctly on GitHub

**Acceptance criteria:**
- Install script runs end-to-end without manual intervention
- Binary works after install
- README displays correctly on GitHub with all badges rendered

---

## Implementation Details

### File Map

| File | Action | Notes |
|---|---|---|
| `README.md` | **Create** | Root of repo |
| `install.sh` | **Create** | Root of repo; must be chmod +x in git |
| `LICENSE` | **Create** | MIT text |
| `package.json` | **Modify** | Add `bin` field |
| `src/index.tsx` | **Verify** | Shebang line must be `#!/usr/bin/env bun` |

### Shebang Check
```sh
head -1 dist/index.js
# Must output: #!/usr/bin/env bun
```
If not, the build config needs `--banner '#!/usr/bin/env bun'`:
```sh
bun build src/index.tsx \
  --outdir=dist \
  --target=bun \
  --banner "#!/usr/bin/env bun"
```
Update the `build` script in `package.json` accordingly.

### Install Script: PATH Detection Pattern
```sh
setup_path() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) return 0 ;;  # already in PATH
  esac

  SHELL_NAME=$(basename "$SHELL")
  case "$SHELL_NAME" in
    zsh)  RC="$HOME/.zshrc" ;;
    bash) RC="$HOME/.bashrc" ;;
    fish) RC="$HOME/.config/fish/config.fish" ;;
    *)    RC="$HOME/.profile" ;;
  esac

  info "Adding $BIN_DIR to PATH in $RC"
  printf '\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$RC"
  warn "Restart your terminal or run: source $RC"
}
```

### Shields.io Badge Examples
```markdown
[![Version](https://img.shields.io/github/package-json/v/dannyfuf/claudios?color=blue)](https://github.com/dannyfuf/claudios)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun-black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
```

### Config Schema Reference (from `src/config/schema.ts`)
Use this as source of truth for the Configuration section of the README:
```
theme          → string (theme name)
editor         → string (default: process.env.EDITOR)
defaultModel   → "sonnet" | "opus" | "haiku" | ...
defaultPermissionMode → "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
keybindings    → object (custom key overrides)
diffMode       → "unified" | "split" (default: "unified")
claudePath     → string (default: "claude")
```

---

## Testing Strategy

### Install Script Testing
```sh
# Test on macOS
curl -fsSL https://raw.githubusercontent.com/dannyfuf/claudios/main/install.sh | sh

# Test idempotency (run twice)
curl -fsSL https://raw.githubusercontent.com/dannyfuf/claudios/main/install.sh | sh
curl -fsSL https://raw.githubusercontent.com/dannyfuf/claudios/main/install.sh | sh

# Test from local file
sh install.sh

# Dry-run lint
shellcheck install.sh   # install shellcheck: brew install shellcheck
```

### Project Tests (existing)
```sh
# Type-check
bun run typecheck

# Unit tests
bun test

# Build
bun run build
```

### Manual Validation Checklist
- [ ] `curl ... | sh` completes without error on macOS arm64
- [ ] `curl ... | sh` completes without error on Linux x86_64 (test in Docker: `docker run --rm -it ubuntu:22.04 sh`)
- [ ] `bclaud --version` works after install
- [ ] `bclaud --help` works after install
- [ ] `bclaud` launches TUI (requires `ANTHROPIC_API_KEY` and Claude Code CLI)
- [ ] README renders correctly on GitHub
- [ ] All badges in README resolve (no broken image links)
- [ ] No broken internal anchor links in README

### Docker Linux Test
```sh
docker run --rm -it ubuntu:22.04 sh -c "
  apt-get update -q && apt-get install -yq curl git unzip &&
  curl -fsSL https://raw.githubusercontent.com/dannyfuf/claudios/main/install.sh | sh
"
```

---

## Definition of Done

- [ ] `LICENSE` file exists at repo root (MIT)
- [ ] `package.json` has a `bin` field pointing to `dist/index.js`
- [ ] `dist/index.js` starts with `#!/usr/bin/env bun` shebang after build
- [ ] `install.sh` exists, is POSIX-compatible, and is idempotent
- [ ] `curl -fsSL <raw-url>/install.sh | sh` works on macOS and Linux
- [ ] `README.md` exists with all required sections (hero, install, config, usage, slash commands, keybindings, contributing, troubleshooting, license)
- [ ] All code blocks in README have language specifiers
- [ ] `bun run typecheck` passes (no TypeScript errors)
- [ ] `bun test` passes (all existing tests green)
- [ ] `bun run build` produces a valid `dist/index.js`
- [ ] `shellcheck install.sh` passes with no errors
- [ ] README renders correctly on GitHub with working badges

---

## Recommended Execution Order

```
Task 1 (binary name + bin field)
  ↓
Task 2 (LICENSE) ←→ Task 3 (install.sh)   [parallel]
  ↓
Task 4 (README)
  ↓
Task 5 (validation)
```

Total estimated effort: **4–6 hours** for a thorough, production-quality result.
