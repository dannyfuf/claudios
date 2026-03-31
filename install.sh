#!/bin/sh
# claudios installer
# Usage: curl -fsSL https://raw.githubusercontent.com/dannyfuf/claudios/main/install.sh | sh
set -eu

REPO="https://github.com/dannyfuf/claudios.git"
INSTALL_DIR="${CLAUDIOS_INSTALL_DIR:-$HOME/.local/share/claudios}"
BIN_DIR="${CLAUDIOS_BIN_DIR:-$HOME/.local/bin}"
BINARY_NAME="claudios"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()    { printf '\033[0;34m[claudios]\033[0m %s\n' "$*"; }
success() { printf '\033[0;32m[claudios]\033[0m %s\n' "$*"; }
warn()    { printf '\033[0;33m[claudios]\033[0m %s\n' "$*"; }
error()   { printf '\033[0;31m[claudios]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# OS / arch detection
# ---------------------------------------------------------------------------

detect_os() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Darwin) OS="macOS" ;;
    Linux)  OS="Linux"  ;;
    *)      error "Unsupported operating system: $OS. Only macOS and Linux are supported." ;;
  esac

  case "$ARCH" in
    x86_64 | amd64) ARCH="x86_64" ;;
    arm64  | aarch64) ARCH="arm64" ;;
    *) error "Unsupported architecture: $ARCH." ;;
  esac

  info "Detected $OS $ARCH"
}

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

check_git() {
  if ! command -v git >/dev/null 2>&1; then
    error "git is required but not found. Please install git and try again."
  fi
}

check_bun() {
  if command -v bun >/dev/null 2>&1; then
    BUN_VERSION="$(bun --version)"
    info "Found Bun $BUN_VERSION"
    return 0
  fi

  warn "Bun not found. Installing Bun..."
  curl -fsSL https://bun.sh/install | sh

  # Add Bun to PATH for this script session
  BUN_HOME="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_HOME/bin:$PATH"

  if ! command -v bun >/dev/null 2>&1; then
    error "Bun installation failed. Please install Bun manually: https://bun.sh"
  fi

  success "Bun installed successfully"
}

check_claude_code() {
  if command -v claude >/dev/null 2>&1; then
    info "Found Claude Code CLI"
  else
    warn "Claude Code CLI not found."
    warn "claudios requires Claude Code to function."
    warn "Install it from: https://claude.ai/download"
    warn "Continuing installation — you can install Claude Code later."
  fi
}

# ---------------------------------------------------------------------------
# Install / update
# ---------------------------------------------------------------------------

install_or_update() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing installation at $INSTALL_DIR ..."
    git -C "$INSTALL_DIR" pull --ff-only
  else
    info "Cloning repository to $INSTALL_DIR ..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone "$REPO" "$INSTALL_DIR"
  fi
}

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

build() {
  info "Installing dependencies..."
  cd "$INSTALL_DIR"
  bun install --frozen-lockfile 2>/dev/null || bun install

  info "Building claudios..."
  bun run build

  # Ensure the output is executable
  chmod +x "$INSTALL_DIR/dist/index.js"
}

# ---------------------------------------------------------------------------
# Link binary
# ---------------------------------------------------------------------------

link_binary() {
  mkdir -p "$BIN_DIR"
  ln -sf "$INSTALL_DIR/dist/index.js" "$BIN_DIR/$BINARY_NAME"
  info "Linked $BINARY_NAME -> $BIN_DIR/$BINARY_NAME"
}

# ---------------------------------------------------------------------------
# Write config with absolute claude path
#
# When claudios runs as an installed binary it inherits the system PATH, not
# the interactive shell PATH. Claude Code is often installed in a directory
# that only appears after shell init files (.zshrc / .bashrc) are sourced,
# so the SDK cannot find it. Persisting the absolute path at install time
# sidesteps this entirely.
# ---------------------------------------------------------------------------

write_claude_path_config() {
  CLAUDE_BIN=$(command -v claude 2>/dev/null || true)

  if [ -z "$CLAUDE_BIN" ]; then
    warn "Could not detect Claude Code CLI path."
    warn "If auth fails after launch, add this to ~/.config/claudios/config.json:"
    warn '  { "claudePath": "/absolute/path/to/claude" }'
    return 0
  fi

  CLAUDIOS_CONFIG_DIR="$HOME/.config/claudios"
  CLAUDIOS_CONFIG_FILE="$CLAUDIOS_CONFIG_DIR/config.json"

  mkdir -p "$CLAUDIOS_CONFIG_DIR"

  if [ -f "$CLAUDIOS_CONFIG_FILE" ]; then
    info "Config already exists at $CLAUDIOS_CONFIG_FILE"
    info "Ensure it contains: \"claudePath\": \"$CLAUDE_BIN\""
  else
    info "Writing config: claudePath = $CLAUDE_BIN"
    printf '{\n  "claudePath": "%s"\n}\n' "$CLAUDE_BIN" > "$CLAUDIOS_CONFIG_FILE"
    success "Config written to $CLAUDIOS_CONFIG_FILE"
  fi
}

# ---------------------------------------------------------------------------
# PATH setup
# ---------------------------------------------------------------------------

setup_path() {
  # Check if BIN_DIR is already in PATH
  case ":$PATH:" in
    *":$BIN_DIR:"*) return 0 ;;
  esac

  SHELL_NAME="$(basename "${SHELL:-sh}")"
  case "$SHELL_NAME" in
    zsh)  RC="$HOME/.zshrc" ;;
    bash) RC="${BASH_ENV:-$HOME/.bashrc}" ;;
    fish) RC="$HOME/.config/fish/config.fish" ;;
    *)    RC="$HOME/.profile" ;;
  esac

  info "Adding $BIN_DIR to PATH in $RC"

  if [ "$SHELL_NAME" = "fish" ]; then
    printf '\nfish_add_path "%s"\n' "$BIN_DIR" >> "$RC"
  else
    printf '\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$RC"
  fi

  warn "Shell config updated. Restart your terminal or run:"
  warn "  source $RC"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  printf '\n'
  info "Installing claudios..."
  printf '\n'

  detect_os
  check_git
  check_bun
  check_claude_code

  install_or_update
  build
  link_binary
  write_claude_path_config
  setup_path

  printf '\n'
  success "Installation complete!"
  printf '\n'
  printf '  Next steps:\n'
  printf '    1. Set your API key:  export ANTHROPIC_API_KEY="sk-ant-..."\n'
  printf '    2. Launch the TUI:    %s\n' "$BINARY_NAME"
  printf '\n'
  printf '  To update later, just run this installer again.\n'
  printf '\n'
}

main "$@"
