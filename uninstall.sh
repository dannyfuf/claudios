#!/bin/sh
# claudios uninstaller
set -eu

INSTALL_DIR="${CLAUDIOS_INSTALL_DIR:-$HOME/.local/share/claudios}"
BIN_DIR="${CLAUDIOS_BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${CLAUDIOS_CONFIG_DIR:-$HOME/.config/claudios}"
CURRENT_BIN="$BIN_DIR/claudios"
LEGACY_BIN="$BIN_DIR/bclaud"

info()    { printf '\033[0;34m[claudios]\033[0m %s\n' "$*"; }
success() { printf '\033[0;32m[claudios]\033[0m %s\n' "$*"; }
warn()    { printf '\033[0;33m[claudios]\033[0m %s\n' "$*"; }

target_exists() {
  [ -e "$1" ] || [ -L "$1" ]
}

show_target() {
  path="$1"
  label="$2"

  if target_exists "$path"; then
    printf '  ✓ %s\n' "$label"
  else
    printf '  - %s\n' "$label"
  fi
}

remove_target() {
  path="$1"
  label="$2"

  if target_exists "$path"; then
    rm -rf -- "$path"
    printf '  removed  %s\n' "$label"
  fi
}

printf '\n'
info "Preparing to uninstall claudios..."
printf '\n'
printf 'The following will be removed:\n'

# Remove both names because the repo currently references both binary names.
show_target "$CURRENT_BIN" "CLI symlink ($CURRENT_BIN)"
show_target "$LEGACY_BIN" "Legacy CLI symlink ($LEGACY_BIN)"
show_target "$INSTALL_DIR" "App files ($INSTALL_DIR)"
show_target "$CONFIG_DIR" "Config ($CONFIG_DIR)"

printf '\n'
printf 'Proceed with uninstall? [y/N] '
read -r answer || true

case "${answer:-}" in
  y|Y|yes|YES)
    ;;
  *)
    warn "Uninstall cancelled."
    exit 0
    ;;
esac

printf '\n'
remove_target "$CURRENT_BIN" "CLI symlink ($CURRENT_BIN)"
remove_target "$LEGACY_BIN" "Legacy CLI symlink ($LEGACY_BIN)"
remove_target "$INSTALL_DIR" "App files ($INSTALL_DIR)"
remove_target "$CONFIG_DIR" "Config ($CONFIG_DIR)"
printf '\n'
success "claudios files removed."
warn "Shell profile PATH changes, Bun, and Claude Code were left untouched."
